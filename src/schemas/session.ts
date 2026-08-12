/**
 * The persistence boundary.
 *
 * The session is written to `localStorage` so that a reload does not cost a researcher the
 * layout they spent five minutes clicking out. What comes back from storage is untrusted: it
 * may have been written by an older version of this app, hand-edited, or truncated by a browser
 * evicting quota mid-write. It is parsed, and a parse failure discards the stored session
 * rather than propagating a half-shaped object into the reactive graph.
 *
 * WHAT IS NOT STORED, and why. No absorbance, no plate text, no concentration — nothing that
 * came off an instrument. The app's promise is that assay data stays on the machine that pasted
 * it, and `localStorage` survives the tab, so a promise about the network is not enough on its
 * own: the plate would still be sitting in the profile of a shared bench laptop the next
 * morning. Only the layout and the settings persist, which are a description of how the
 * experiment was arranged rather than what it measured.
 *
 * See features/analysis/analysis-workflow.feature — "no assay value is written to persistent
 * storage" and "the layout and settings are restored after a reload".
 */

import { z } from 'zod'
import { FitModel, Procedure, StandardsDirection } from '~/domain/constants'
import { PlateTextSchema } from './upload'

export const STORAGE_KEY = 'bca-web.session.v1'

const SampleAssignment = z.object({
  name: z.string().max(120),
  region: z.string().max(200),
})

export const StoredSessionSchema = z.object({
  version: z.literal(1),
  sampleNames: z.array(z.string().max(120)).max(96).default([]),
  sampleAssignments: z.array(SampleAssignment).max(96).default([]),
  standardRegions: z.array(z.string().max(200)).max(12).default([]),
  blankSubtract: z.boolean().default(true),
  fitModel: z.enum([
    FitModel.INVERSE_CUBIC,
    FitModel.INVERSE_QUADRATIC,
    FitModel.INVERSE_LINEAR,
  ]).default(FitModel.INVERSE_CUBIC),
  dilutionFactor: z.number().positive().finite().default(1),
  standardsDirection: z.enum([
    StandardsDirection.DESCENDING,
    StandardsDirection.ASCENDING,
  ]).default(StandardsDirection.DESCENDING),
  procedure: z.enum([
    Procedure.MICROPLATE_STANDARD,
    Procedure.MICROPLATE_REDUCED_SAMPLE,
    Procedure.TEST_TUBE_STANDARD,
    Procedure.TEST_TUBE_ENHANCED,
  ]).default(Procedure.MICROPLATE_STANDARD),
})

export type StoredSession = z.infer<typeof StoredSessionSchema>

export const DEFAULT_SESSION: StoredSession = StoredSessionSchema.parse({ version: 1 })

/**
 * The browser's local storage, if this environment has one.
 *
 * Read through an index rather than as `globalThis.localStorage`, which the DOM library types as
 * always present. It is not: the unit tests run under node, where it is absent, and the guards
 * below are what keep that from being a crash. Typing it honestly is also what stops the
 * type-checker calling those guards dead.
 */
function browserStorage(): Storage | undefined {
  return (globalThis as { localStorage?: Storage }).localStorage
}

/**
 * Where the plate is held, which is deliberately not where the session is.
 *
 * `sessionStorage` is scoped to the tab: it survives a reload and dies when the tab closes.
 * That is the whole distinction the promise above turns on. The plate may not be waiting in a
 * shared laptop's profile tomorrow morning, but somebody who has spent ten minutes typing
 * ninety-six wells by hand should not lose them to a reload — see
 * features/analysis/plate-grid.feature, which asserts both halves.
 *
 * This is the one thing off an instrument that is written anywhere, and it is the narrowest
 * place that can hold it.
 */
export const PLATE_STORAGE_KEY = 'bca-web.plate.v1'

function tabStorage(): Storage | undefined {
  return (globalThis as { sessionStorage?: Storage }).sessionStorage
}

/** Read the plate held for this tab, or nothing at all. Untrusted, so it is validated. */
export function loadPlateText(storage: Storage | undefined = tabStorage()): string {
  if (!storage) return ''
  try {
    const raw = storage.getItem(PLATE_STORAGE_KEY)
    if (raw === null) return ''
    const parsed = PlateTextSchema.safeParse(raw)
    return parsed.success ? parsed.data : ''
  } catch {
    return ''
  }
}

/** Hold the plate for this tab. An empty plate clears the slot rather than storing "". */
export function savePlateText(text: string, storage: Storage | undefined = tabStorage()): void {
  if (!storage) return
  try {
    if (text.trim() === '') storage.removeItem(PLATE_STORAGE_KEY)
    else storage.setItem(PLATE_STORAGE_KEY, text)
  } catch {
    // Quota, or storage disabled. Losing the held plate costs a retype; throwing here would
    // cost the analysis on screen.
  }
}

/** Read the stored session, or the defaults if there is nothing usable there. */
export function loadSession(storage: Storage | undefined = browserStorage()): StoredSession {
  if (!storage) return DEFAULT_SESSION
  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    // Storage can throw outright in a private window or under a blocking cookie policy.
    return DEFAULT_SESSION
  }
  if (raw === null) return DEFAULT_SESSION

  try {
    const parsed = StoredSessionSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : DEFAULT_SESSION
  } catch {
    return DEFAULT_SESSION
  }
}

/** Write the session. A storage failure is not worth interrupting an analysis over. */
export function saveSession(
  session: StoredSession,
  storage: Storage | undefined = browserStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // Quota exceeded, or storage disabled. The session is a convenience; losing it costs a
    // reload's worth of clicking, and throwing here would cost the analysis in progress.
  }
}
