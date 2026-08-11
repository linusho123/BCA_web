import { describe, expect, it } from 'vitest'
import { IssueCode, Severity } from '~/domain/errors'
import {
  MAX_PLATE_TEXT_BYTES,
  MAX_UPLOAD_BYTES,
  PlateTextSchema,
  UploadSchema,
  readUpload,
  validatePlateText,
} from './upload'

/**
 * Proves the boundary half of features/plate/plate-file-import.feature and
 * features/plate/plate-reader-paste.feature: how much may be pasted, and what counts as a file.
 */

/** The shape a drop event, a file input and a test all agree on. */
const upload = (over: Partial<{ name: string; size: number; bytes: Uint8Array }> = {}) => {
  const bytes = over.bytes ?? new Uint8Array([0x41, 0x2c, 0x42])
  return {
    name: over.name ?? 'plate.csv',
    size: over.size ?? bytes.byteLength,
    arrayBuffer: () => Promise.resolve(bytes.buffer as ArrayBuffer),
  }
}

describe('the paste cap', () => {
  it('lets a plate through', () => {
    // A 384-well plate of long readings with instrument headers is comfortably under the cap.
    const grid = Array.from({ length: 16 }, () =>
      Array.from({ length: 24 }, () => '0.1234567').join('\t'),
    ).join('\n')
    expect(validatePlateText(grid)).toEqual({ text: grid, issues: [] })
    expect(grid.length).toBeLessThan(MAX_PLATE_TEXT_BYTES)
  })

  it('accepts text right up to the cap and refuses one character past it', () => {
    expect(PlateTextSchema.safeParse('x'.repeat(MAX_PLATE_TEXT_BYTES)).success).toBe(true)
    expect(PlateTextSchema.safeParse('x'.repeat(MAX_PLATE_TEXT_BYTES + 1)).success).toBe(false)
  })

  it('refuses an oversized paste with an issue rather than by throwing', () => {
    // The whole reactive chain re-runs on every keystroke in the paste box; a megabyte pasted by
    // accident makes the page feel broken rather than busy.
    const { text, issues } = validatePlateText('x'.repeat(MAX_PLATE_TEXT_BYTES + 1))
    expect(text).toBe('')
    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe(IssueCode.NON_NUMERIC_INPUT)
    expect(issues[0]?.severity).toBe(Severity.ERROR)
    expect(issues[0]?.field).toBe('text')
    expect(issues[0]?.message).toContain('paste only the grid')
  })

  it('passes an empty paste through, because an empty box is not an error yet', () => {
    // Judging an empty grid is parsePlate's job; refusing it here would put an error under a
    // box the user has not finished filling in.
    expect(validatePlateText('')).toEqual({ text: '', issues: [] })
  })

  it('does not trim or otherwise alter what was pasted', () => {
    // The parser reads alignment and blank lines; this layer decides size and nothing else.
    const raw = '\n  A1\t0.132  \n\n'
    expect(validatePlateText(raw).text).toBe(raw)
  })
})

describe('what counts as a file', () => {
  it('accepts the structural shape rather than requiring a real File', () => {
    // The object arrives from a drop event, a file input or a test, and only one of those three
    // produces a real File.
    expect(UploadSchema.safeParse(upload()).success).toBe(true)
  })

  it.each([
    ['null', null],
    ['a string', 'plate.csv'],
    ['a bare object', {}],
    ['an object with no reader', { name: 'p.csv', size: 3 }],
    ['an object whose reader is not callable', { name: 'p.csv', size: 3, arrayBuffer: 'nope' }],
  ])('refuses %s', (_what, value) => {
    expect(UploadSchema.safeParse(value).success).toBe(false)
  })

  it('defaults a missing name rather than refusing over it', () => {
    // A clipboard file can arrive nameless; the name is only ever shown back to the user.
    const parsed = UploadSchema.safeParse({ size: 3, arrayBuffer: () => Promise.resolve(new ArrayBuffer(3)) })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.name).toBe('')
  })

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
  ])('refuses a %s size, which no real file reports', (_what, size) => {
    expect(UploadSchema.safeParse(upload({ size })).success).toBe(false)
  })

  it('accepts an empty file, leaving "there is nothing in it" to the parser', () => {
    expect(UploadSchema.safeParse(upload({ size: 0, bytes: new Uint8Array() })).success).toBe(true)
  })

  it('accepts a file right up to the cap and refuses one byte past it', () => {
    expect(UploadSchema.safeParse(upload({ size: MAX_UPLOAD_BYTES })).success).toBe(true)
    expect(UploadSchema.safeParse(upload({ size: MAX_UPLOAD_BYTES + 1 })).success).toBe(false)
  })
})

describe('readUpload', () => {
  it('returns the bytes of a readable file', async () => {
    const bytes = new Uint8Array([0x30, 0x2e, 0x31])
    const { bytes: read, issues } = await readUpload(upload({ bytes }))
    expect(issues).toEqual([])
    expect([...(read as Uint8Array)]).toEqual([0x30, 0x2e, 0x31])
  })

  it('reports a refused file as an issue rather than by rejecting', async () => {
    const { bytes, issues } = await readUpload({ name: 'p.csv', size: 3 })
    expect(bytes).toBeNull()
    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe(IssueCode.UNDECODABLE_UPLOAD)
    expect(issues[0]?.field).toBe('file')
  })

  it('names the size in the refusal, so an oversized file says why it was refused', async () => {
    const { issues } = await readUpload(upload({ size: MAX_UPLOAD_BYTES + 1 }))
    expect(issues[0]?.message).toContain('save just the grid as CSV')
  })

  it('reports a read that fails part way as an issue, not as an unhandled rejection', async () => {
    // A file moved or unmounted between the drop and the read rejects from arrayBuffer().
    const { bytes, issues } = await readUpload({
      name: 'gone.csv',
      size: 12,
      arrayBuffer: () => Promise.reject(new DOMException('NotFoundError')),
    })
    expect(bytes).toBeNull()
    expect(issues[0]?.code).toBe(IssueCode.UNDECODABLE_UPLOAD)
    expect(issues[0]?.message).toContain('could not be read from disk')
  })

  it('reports a reader that throws synchronously the same way', async () => {
    const { bytes, issues } = await readUpload({
      name: 'gone.csv',
      size: 12,
      arrayBuffer: () => {
        throw new Error('boom')
      },
    })
    expect(bytes).toBeNull()
    expect(issues[0]?.code).toBe(IssueCode.UNDECODABLE_UPLOAD)
  })

  it('does not judge what the bytes are', async () => {
    // Deciding whether these are a workbook, an image or a CSV is decodePlateBytes's job, and
    // the signatures it checks are part of the plate story rather than the upload story.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const { bytes, issues } = await readUpload(upload({ name: 'plate.png', bytes: png }))
    expect(issues).toEqual([])
    expect([...(bytes as Uint8Array)]).toEqual([...png])
  })
})
