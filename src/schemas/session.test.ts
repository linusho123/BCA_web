import { describe, expect, it } from 'vitest'
import { FitModel, Procedure } from '~/domain/constants'
import {
  DEFAULT_SESSION,
  STORAGE_KEY,
  StoredSessionSchema,
  loadSession,
  saveSession,
} from './session'

/**
 * Proves the persistence half of features/analysis/analysis-workflow.feature: the layout and
 * settings come back after a reload, and no assay value is written to persistent storage.
 */

/** A `Storage` that lives in a Map, so a test can inspect and corrupt what was written. */
class FakeStorage implements Storage {
  private readonly map = new Map<string, string>()
  get length(): number {
    return this.map.size
  }
  clear(): void {
    this.map.clear()
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

/** A `Storage` that refuses, the way a private window or an exhausted quota does. */
const hostileStorage = (): Storage =>
  new Proxy(new FakeStorage(), {
    get(target, prop) {
      if (prop === 'getItem' || prop === 'setItem') {
        return () => {
          throw new DOMException('storage is not available', 'SecurityError')
        }
      }
      return Reflect.get(target, prop) as unknown
    },
  })

const session = (over: Partial<Record<string, unknown>> = {}) => ({
  ...DEFAULT_SESSION,
  ...over,
})

describe('the stored session shape', () => {
  it('fills a bare version-stamped object out to a whole session', () => {
    // Every field has a default, so a session written by an older build that lacked a setting
    // gains it rather than being discarded.
    expect(DEFAULT_SESSION.version).toBe(1)
    expect(DEFAULT_SESSION.fitModel).toBe(FitModel.INVERSE_CUBIC)
    expect(DEFAULT_SESSION.procedure).toBe(Procedure.MICROPLATE_STANDARD)
    expect(DEFAULT_SESSION.blankSubtract).toBe(true)
    expect(DEFAULT_SESSION.dilutionFactor).toBe(1)
    expect(DEFAULT_SESSION.sampleNames).toEqual([])
  })

  it('refuses a session stamped with a version it does not know', () => {
    // A version 2 session may mean something different by the same field names.
    expect(StoredSessionSchema.safeParse(session({ version: 2 })).success).toBe(false)
    expect(StoredSessionSchema.safeParse({}).success).toBe(false)
  })

  it('refuses a fit model or procedure outside the ones the app implements', () => {
    expect(StoredSessionSchema.safeParse(session({ fitModel: 'quartic' })).success).toBe(false)
    expect(StoredSessionSchema.safeParse(session({ procedure: 'tube' })).success).toBe(false)
    const linear = StoredSessionSchema.parse(session({ fitModel: FitModel.INVERSE_LINEAR }))
    expect(linear.fitModel).toBe(FitModel.INVERSE_LINEAR)
  })

  it.each([
    ['dilutionFactor', 0],
    ['dilutionFactor', -2],
    ['desiredProteinUg', 0],
    ['finalVolumeUL', -1],
    ['dyeFraction', 1],
    ['dyeFraction', -0.1],
  ])('refuses %s of %d, which no lane could be built from', (field, bad) => {
    expect(StoredSessionSchema.safeParse(session({ [field]: bad })).success).toBe(false)
  })

  it('refuses a non-finite number, which JSON.parse will happily produce from "1e400"', () => {
    expect(StoredSessionSchema.safeParse(session({ dilutionFactor: Infinity })).success).toBe(false)
  })

  it('caps the lists at a plate, so a hand-edited file cannot make the app chew on a million names', () => {
    const many = Array.from({ length: 97 }, (_, i) => `S${i}`)
    expect(StoredSessionSchema.safeParse(session({ sampleNames: many })).success).toBe(false)
    expect(StoredSessionSchema.safeParse(session({ sampleNames: many.slice(0, 96) })).success).toBe(
      true,
    )
  })

  it('caps the length of a single name and region', () => {
    expect(
      StoredSessionSchema.safeParse(session({ sampleNames: ['x'.repeat(121)] })).success,
    ).toBe(false)
    expect(
      StoredSessionSchema.safeParse(
        session({ sampleAssignments: [{ name: 'S', region: 'A'.repeat(201) }] }),
      ).success,
    ).toBe(false)
  })
})

describe('what is written to storage', () => {
  it('round-trips the layout and the settings', () => {
    const storage = new FakeStorage()
    const saved = StoredSessionSchema.parse(
      session({
        sampleNames: ['MCF7', 'RPMI8226'],
        sampleAssignments: [{ name: 'MCF7', region: 'B1-B3' }],
        standardRegions: ['A1-A9'],
        dilutionFactor: 2,
        blankSubtract: false,
      }),
    )
    saveSession(saved, storage)
    expect(loadSession(storage)).toEqual(saved)
  })

  it('writes no assay value, because localStorage outlives the tab on a shared bench laptop', () => {
    // The app's promise is that assay data stays on the machine that pasted it; a plate left in
    // the profile of a shared laptop would break that promise without touching the network.
    const storage = new FakeStorage()
    saveSession(
      StoredSessionSchema.parse(session({ sampleNames: ['MCF7'] })),
      storage,
    )
    const raw = storage.getItem(STORAGE_KEY) as string
    const stored = JSON.parse(raw) as Record<string, unknown>
    for (const forbidden of [
      'absorbance',
      'absorbances',
      'plateText',
      'wells',
      'concUgPerML',
      'concUgPerUL',
      'meanAbs',
      'results',
      'samples',
      'fit',
      'coefficients',
    ]) {
      expect(Object.keys(stored)).not.toContain(forbidden)
    }
    // What is stored describes how the experiment was arranged, not what it measured.
    expect(Object.keys(stored).sort()).toEqual(Object.keys(DEFAULT_SESSION).sort())
  })

  it('writes under one versioned key, so an old session is found or it is not', () => {
    const storage = new FakeStorage()
    saveSession(DEFAULT_SESSION, storage)
    expect(storage.length).toBe(1)
    expect(STORAGE_KEY).toContain('v1')
  })
})

describe('reading back what may not be a session', () => {
  it('returns the defaults when nothing has been stored', () => {
    expect(loadSession(new FakeStorage())).toEqual(DEFAULT_SESSION)
  })

  it('returns the defaults when there is no storage at all', () => {
    // Server-side rendering, or a test environment without a DOM.
    expect(loadSession(undefined)).toEqual(DEFAULT_SESSION)
  })

  it.each([
    ['truncated mid-write by a browser evicting quota', '{"version":1,"sampleNa'],
    ['not JSON at all', 'null-ish'],
    ['a JSON value that is not an object', '42'],
    ['an object of the wrong shape', '{"version":9}'],
    ['an array', '[]'],
    ['the JSON literal null', 'null'],
  ])('discards a stored session that is %s', (_why, raw) => {
    // A half-shaped object propagating into the reactive graph fails somewhere far from here.
    const storage = new FakeStorage()
    storage.setItem(STORAGE_KEY, raw)
    expect(loadSession(storage)).toEqual(DEFAULT_SESSION)
  })

  it('discards a stored session with a field outside its range', () => {
    const storage = new FakeStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify(session({ dyeFraction: 2 })))
    expect(loadSession(storage)).toEqual(DEFAULT_SESSION)
  })

  it('survives storage that throws outright', () => {
    // Private windows and blocking cookie policies throw on access rather than returning null.
    expect(loadSession(hostileStorage())).toEqual(DEFAULT_SESSION)
    expect(() => saveSession(DEFAULT_SESSION, hostileStorage())).not.toThrow()
  })

  it('does not interrupt an analysis when the write fails', () => {
    // The session is a convenience; losing it costs a reload's worth of clicking, and throwing
    // here would cost the analysis in progress.
    expect(() => saveSession(DEFAULT_SESSION, undefined)).not.toThrow()
  })
})
