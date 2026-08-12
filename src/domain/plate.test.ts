import { describe, expect, it } from 'vitest'
import { IssueCode, Severity, hasCode, hasErrors } from './errors'
import {
  EMPTY_PLATE,
  decodePlateBytes,
  extractColumn,
  extractRow,
  parseNumeric,
  parsePlate,
  parsePlateCsv,
  wellValue,
  writeWell,
  findGrid,
  EMPTY_WELL_TOKEN,
} from './plate'
import { REFERENCE_ABSORBANCES, referencePlateText } from './reference'

/** Proves features/plate/plate-reader-paste.feature and features/plate/plate-file-import.feature. */

const codesOf = (issues: readonly { code: IssueCode }[]) => issues.map((i) => i.code)

/** Context travels as sorted key/value pairs so exports stay stable; read one back by key. */
const ctx = (issue: { context: ReadonlyArray<readonly [string, string]> } | undefined, key: string) =>
  issue?.context.find(([k]) => k === key)?.[1]

const encode = (text: string) => new TextEncoder().encode(text)

describe('parseNumeric', () => {
  it.each([
    ['0.132', 0.132],
    ['+1.5', 1.5],
    ['-0.004', -0.004],
    ['1e-3', 0.001],
    ['2E3', 2000],
    ['.5', 0.5],
    ['1_000', 1000],
    ['3.', 3],
  ])('reads %s as %d', (token, expected) => {
    expect(parseNumeric(token)).toBe(expected)
  })

  it.each(['', 'abc', '0x10', '1,5', '--1', '1.2.3', ' 0.1', 'e5'])(
    'refuses %j rather than inventing a number',
    (token) => {
      expect(parseNumeric(token)).toBeUndefined()
    },
  )

  it('reads the special forms as themselves so the caller can reject them by value', () => {
    expect(parseNumeric('nan')).toBeNaN()
    expect(parseNumeric('inf')).toBe(Infinity)
    expect(parseNumeric('-Infinity')).toBe(-Infinity)
  })
})

describe('separators', () => {
  const expected = [
    [0.132, 0.159, 0.262],
    [0.391, 0.636, 0.895],
  ]

  it.each([
    ['tabs', '0.132\t0.159\t0.262\n0.391\t0.636\t0.895'],
    ['commas', '0.132,0.159,0.262\n0.391,0.636,0.895'],
    ['spaces', '0.132 0.159 0.262\n0.391 0.636 0.895'],
    ['runs of spaces', '0.132   0.159     0.262\n 0.391  0.636   0.895 '],
  ])('parses the same grid from %s', (_name, text) => {
    const data = parsePlate(text, { expectedRows: 2, expectedCols: 3 })
    expect(data.values).toEqual(expected)
    expect(data.issues).toEqual([])
  })

  it('treats a comma as a decimal point when the columns are spaced', () => {
    // A German-locale export writes "0,132" and separates its columns with whitespace. Splitting
    // on the comma would turn three readings into six half-numbers.
    const data = parsePlate('0,132 0,159 0,262\n0,391 0,636 0,895', {
      expectedRows: 2,
      expectedCols: 3,
    })
    expect(data.values).toEqual(expected)
  })

  it('prefers tabs over commas so decimal commas inside tab-separated columns survive', () => {
    const data = parsePlate('0,132\t0,159\n0,391\t0,636', { expectedRows: 2, expectedCols: 2 })
    expect(data.nCols).toBe(2)
    expect(data.values).toEqual([
      [0.132, 0.159],
      [0.391, 0.636],
    ])
  })
})

describe('labels and shape', () => {
  it('strips a column header and a row-letter column', () => {
    const text = '\t1\t2\t3\nA\t0.1\t0.2\t0.3\nB\t0.4\t0.5\t0.6'
    const data = parsePlate(text, { expectedRows: 2, expectedCols: 3 })
    expect(data.nRows).toBe(2)
    expect(data.nCols).toBe(3)
    expect(data.rowLabels).toEqual(['A', 'B'])
    expect(data.values[0]).toEqual([0.1, 0.2, 0.3])
  })

  it('labels rows A onward when the paste carries no labels of its own', () => {
    const data = parsePlate('0.1\t0.2\n0.3\t0.4', { expectedRows: 2, expectedCols: 2 })
    expect(data.rowLabels).toEqual(['A', 'B'])
  })

  it('ignores blank lines and trailing whitespace', () => {
    const text = '\n0.1\t0.2\t \n\n0.3\t0.4\t\n  \n'
    const data = parsePlate(text, { expectedRows: 2, expectedCols: 2 })
    expect(data.nRows).toBe(2)
    expect(data.nCols).toBe(2)
    expect(hasCode(data.issues, IssueCode.RAGGED_ROWS)).toBe(false)
  })

  it('reads back by row and by column under the plate labels', () => {
    // Column 1 is the top of the series, column 9 the blank: the plate is laid out the way it is
    // pipetted, which is the reverse of the workbook's ascending list.
    const plateRow = [...REFERENCE_ABSORBANCES].reverse()
    const data = parsePlate(referencePlateText())
    expect(wellValue(data, 'A', 1)).toBe(2.051)
    expect(wellValue(data, 'a', 9)).toBe(0.132)
    expect(extractRow(data, 'A').slice(0, 9)).toEqual(plateRow)
    expect(extractColumn(data, 1)).toEqual([2.051, 2.051, 0.43, 0.36, null, null, null, null])
  })

  it.each([
    ['a row that is not on the plate', () => wellValue(parsePlate('0.1\t0.2'), 'Z', 1)],
    ['a column past the edge', () => wellValue(parsePlate('0.1\t0.2'), 'A', 99)],
    ['column zero', () => wellValue(parsePlate('0.1\t0.2'), 'A', 0)],
  ])('returns nothing for %s rather than throwing', (_name, read) => {
    expect(read()).toBeNull()
  })

  it('returns an empty slice for a row or column outside the grid', () => {
    const data = parsePlate('0.1\t0.2')
    expect(extractRow(data, 'Z')).toEqual([])
    expect(extractColumn(data, 99)).toEqual([])
  })

  it('warns when the block is not the plate that was expected', () => {
    const data = parsePlate('0.132\t0.159\n0.391\t0.636')
    expect(hasCode(data.issues, IssueCode.UNEXPECTED_SHAPE)).toBe(true)
    const shape = data.issues.find((i) => i.code === IssueCode.UNEXPECTED_SHAPE)
    expect(shape?.severity).toBe(Severity.WARN)
    // A warning, not an error: the values are still readable and a partial read is legitimate.
    expect(hasErrors(data.issues)).toBe(false)
    expect(data.values[0]).toEqual([0.132, 0.159])
  })

  it('accepts the reference plate as the shape it is', () => {
    const data = parsePlate(referencePlateText())
    expect(data.nRows).toBe(8)
    expect(data.nCols).toBe(12)
    expect(hasCode(data.issues, IssueCode.UNEXPECTED_SHAPE)).toBe(false)
    expect(hasErrors(data.issues)).toBe(false)
  })
})

describe('cells that are not measurements', () => {
  it.each(['OVRFLW', 'overflow', '####', 'Saturated'])(
    'names %s as saturation, keeping no value',
    (token) => {
      const data = parsePlate(`0.1\t${token}`, { expectedRows: 1, expectedCols: 2 })
      expect(data.values[0]).toEqual([0.1, null])
      const found = data.issues.find((i) => i.code === IssueCode.OVERFLOW_CELL)
      expect(found?.severity).toBe(Severity.WARN)
      expect(found?.field).toBe('A2')
      expect(found?.message).toContain('A2')
    },
  )

  it.each(['-', 'NA', 'n/a', 'null', 'none', '#N/A', ''])(
    'treats %j as an un-plated well rather than a failed read',
    (token) => {
      const data = parsePlate(`0.1\t${token}\t0.3`, { expectedRows: 1, expectedCols: 3 })
      expect(data.values[0]).toEqual([0.1, null, 0.3])
      expect(hasCode(data.issues, IssueCode.OVERFLOW_CELL)).toBe(false)
      expect(hasErrors(data.issues)).toBe(false)
    },
  )

  it('says nothing at all about an un-plated well', () => {
    // The workbook's plate has 24 readings in it and 72 empty wells, which is what a plate
    // normally looks like. An earlier version summarised those 72 into one note; the grid on
    // screen now shows all 96 wells regardless, so that note was on every plate forever and
    // named six wells by name that nobody had left empty by mistake. The empty well worth
    // reporting is one inside a region somebody assigned — see mapSamples in layout.ts.
    const data = parsePlate(referencePlateText())
    expect(codesOf(data.issues)).not.toContain(IssueCode.NON_NUMERIC_CELL)
    expect(hasErrors(data.issues)).toBe(false)
  })

  it('still names a well whose detector saturated, which is news', () => {
    // The rule above is about wells nobody plated, not about wells that failed to read.
    const data = parsePlate(referencePlateText().replace('0.132', 'OVRFLW'))
    expect(codesOf(data.issues)).toContain(IssueCode.OVERFLOW_CELL)
  })

  it('names a cell that is not a number, against the well it sits in', () => {
    const data = parsePlate('0.1\tERR\t0.3', { expectedRows: 1, expectedCols: 3 })
    expect(data.values[0]).toEqual([0.1, null, 0.3])
    const found = data.issues.find((i) => i.code === IssueCode.NON_NUMERIC_CELL)
    expect(found?.severity).toBe(Severity.WARN)
    expect(found?.field).toBe('A2')
    expect(found?.message).toContain('ERR')
  })

  it('flags a negative absorbance and keeps it', () => {
    const data = parsePlate('0.1\t-0.004', { expectedRows: 1, expectedCols: 2 })
    expect(data.values[0]).toEqual([0.1, -0.004])
    const found = data.issues.find((i) => i.code === IssueCode.NEGATIVE_ABSORBANCE)
    expect(found?.severity).toBe(Severity.WARN)
    expect(found?.field).toBe('A2')
  })

  it('drops an infinity, which is a broken read rather than a large one', () => {
    const data = parsePlate('0.1\tinf', { expectedRows: 1, expectedCols: 2 })
    expect(data.values[0]).toEqual([0.1, null])
    expect(hasCode(data.issues, IssueCode.NON_NUMERIC_CELL)).toBe(true)
  })
})

describe('refusals', () => {
  it.each([
    ['nothing at all', ''],
    ['whitespace', '   \n\t\n  '],
    ['newlines', '\n\n\n'],
  ])('refuses %s without producing a grid', (_name, text) => {
    const data = parsePlate(text)
    expect(data).toEqual({ ...EMPTY_PLATE, issues: data.issues })
    expect(data.values).toEqual([])
    expect(codesOf(data.issues)).toEqual([IssueCode.EMPTY_INPUT])
    expect(hasErrors(data.issues)).toBe(true)
  })

  it('refuses labels with no values behind them', () => {
    const data = parsePlate('A\nB\nC')
    expect(data.values).toEqual([])
    expect(codesOf(data.issues)).toEqual([IssueCode.EMPTY_INPUT])
  })

  it('names the row when the grid is ragged', () => {
    const data = parsePlate('0.1\t0.2\t0.3\n0.4\t0.5', { expectedRows: 2, expectedCols: 3 })
    const found = data.issues.find((i) => i.code === IssueCode.RAGGED_ROWS)
    expect(found?.severity).toBe(Severity.ERROR)
    expect(ctx(found, 'rows')).toBe('2')
    expect(found?.message).toContain('2')
  })

  it('still reports a ragged grid sitting under a valid header', () => {
    const data = parsePlate('\t1\t2\t3\nA\t0.1\t0.2\t0.3\nB\t0.4\t0.5', {
      expectedRows: 2,
      expectedCols: 3,
    })
    expect(hasCode(data.issues, IssueCode.RAGGED_ROWS)).toBe(true)
    expect(data.rowLabels).toEqual(['A', 'B'])
  })

  it('reports one error, not ninety-six warnings, when nothing reads', () => {
    const rows = Array<string>(8).fill(Array<string>(12).fill('OVRFLW').join('\t'))
    const data = parsePlate(rows.join('\n'))
    expect(hasCode(data.issues, IssueCode.NO_READABLE_CELLS)).toBe(true)
    const found = data.issues.find((i) => i.code === IssueCode.NO_READABLE_CELLS)
    expect(found?.severity).toBe(Severity.ERROR)
    // The per-well warnings are still there beneath it — but the error is what the panel leads
    // with, and it says the one thing that is true of the whole read.
    expect(hasErrors(data.issues)).toBe(true)
  })

  it.each([
    ['a lone minus sign', '-'],
    ['a stray quote', '"'],
    ['control characters', ' '],
    ['a very long token', 'x'.repeat(5000)],
    ['mixed separators everywhere', '0.1,\t 0.2\t,0.3\n,,\t\t'],
  ])('returns issues rather than throwing on %s', (_name, text) => {
    expect(() => parsePlate(text)).not.toThrow()
    const data = parsePlate(text)
    expect(Array.isArray(data.values)).toBe(true)
  })
})

describe('file import', () => {
  it('imports a CSV to the same plate as the same text pasted', () => {
    const text = referencePlateText().replace(/\t/g, ',')
    expect(parsePlateCsv(text).values).toEqual(parsePlate(text).values)
    expect(parsePlateCsv(encode(text)).values).toEqual(parsePlate(text).values)
  })

  it('strips a byte order mark instead of gluing it to the first cell', () => {
    const withBom = encode('﻿0.132\t0.159\n0.391\t0.636')
    const data = parsePlateCsv(withBom, { expectedRows: 2, expectedCols: 2 })
    expect(data.values[0]).toEqual([0.132, 0.159])
    expect(hasErrors(data.issues)).toBe(false)
  })

  it('decodes a cp1252 export rather than refusing it', () => {
    // 0xB5 is "µ" in cp1252 and an invalid lone continuation byte in UTF-8 — exactly what Excel
    // on Windows writes into a header like "Abs (µ)".
    const bytes = new Uint8Array([...encode('A\t0.132\nB\t0.391\n'), 0xb5, 0x0a])
    const { text, issues } = decodePlateBytes(bytes)
    expect(issues).toEqual([])
    expect(text).toContain('µ')
  })

  it('imports a tab separated export as readily as a comma separated one', () => {
    const tabs = parsePlateCsv(encode('0.132\t0.159\n0.391\t0.636'), {
      expectedRows: 2,
      expectedCols: 2,
    })
    const commas = parsePlateCsv(encode('0.132,0.159\n0.391,0.636'), {
      expectedRows: 2,
      expectedCols: 2,
    })
    expect(tabs.values).toEqual(commas.values)
  })

  it.each([
    [[0x50, 0x4b, 0x03, 0x04], 'zipped workbook'],
    [[0xd0, 0xcf, 0x11, 0xe0], '.xls'],
    [[0x25, 0x50, 0x44, 0x46], 'PDF'],
    [[0x89, 0x50, 0x4e, 0x47], 'PNG'],
    [[0xff, 0xd8, 0xff], 'JPEG'],
  ])('names a binary upload starting %j as its own format', (signature, mention) => {
    const bytes = new Uint8Array([...signature, ...Array<number>(64).fill(0x41)])
    const data = parsePlateCsv(bytes)
    const found = data.issues.find((i) => i.code === IssueCode.BINARY_UPLOAD)
    expect(found?.severity).toBe(Severity.ERROR)
    expect(found?.message).toContain(mention)
    // And it says what to do next, which is the part that saves the second attempt.
    expect(found?.message).toMatch(/CSV|paste/)
    expect(data.values).toEqual([])
  })

  it('does not add "contained no data" on top of a binary refusal', () => {
    const data = parsePlateCsv(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))
    expect(codesOf(data.issues)).toEqual([IssueCode.BINARY_UPLOAD])
  })

  it('refuses an empty file without producing a grid', () => {
    const data = parsePlateCsv(new Uint8Array([]))
    expect(data.values).toEqual([])
    expect(codesOf(data.issues)).toEqual([IssueCode.EMPTY_INPUT])
  })

  it('reports a ragged CSV as ragged rather than as an import failure', () => {
    const data = parsePlateCsv(encode('0.1,0.2,0.3\n0.4,0.5'), {
      expectedRows: 2,
      expectedCols: 3,
    })
    expect(hasCode(data.issues, IssueCode.RAGGED_ROWS)).toBe(true)
    expect(hasCode(data.issues, IssueCode.BINARY_UPLOAD)).toBe(false)
  })

  it('returns issues rather than throwing on hostile bytes', () => {
    const hostile = new Uint8Array(Array.from({ length: 256 }, (_, i) => (i * 37) % 256))
    expect(() => parsePlateCsv(hostile)).not.toThrow()
    expect(parsePlateCsv(hostile).issues.length).toBeGreaterThan(0)
  })
})

/** Proves features/analysis/plate-grid.feature. */
describe('writeWell', () => {
  const at = (text: string, row: string, col: number) => wellValue(parsePlate(text), row, col)

  it('seeds a whole 8 by 12 plate when there was no grid at all', () => {
    const data = parsePlate(writeWell('', 'C1', '0.430'))
    expect(data.nRows).toBe(8)
    expect(data.nCols).toBe(12)
    expect(wellValue(data, 'C', 1)).toBe(0.43)
  })

  it('leaves every other well of a seeded grid empty rather than zero', () => {
    const data = parsePlate(writeWell('', 'C1', '0.430'))
    expect(wellValue(data, 'C', 2)).toBeNull()
    expect(wellValue(data, 'A', 1)).toBeNull()
    expect(wellValue(data, 'H', 12)).toBeNull()
  })

  it('replaces one well of an existing grid and disturbs no other', () => {
    // Row A runs down from the 2000 ug/mL tube, so its nth well is the nth absorbance counted
    // from the end of the workbook's ascending list.
    const plateRow = [...REFERENCE_ABSORBANCES].reverse()
    const edited = writeWell(referencePlateText(), 'A3', '0.2705')
    expect(at(edited, 'A', 3)).toBe(0.2705)
    expect(at(edited, 'A', 4)).toBe(plateRow[3])
    expect(at(edited, 'C', 1)).toBe(0.43)
  })

  it('keeps an instrument sentinel verbatim so the overflow issue still fires', () => {
    // The reason this works on text rather than on parsed values: "OVRFLW" parses to null, so a
    // round trip through PlateData would turn a saturated read into an empty well.
    const data = parsePlate(writeWell(referencePlateText(), 'D5', 'OVRFLW'))
    expect(hasCode(data.issues, IssueCode.OVERFLOW_CELL)).toBe(true)
  })

  it('accepts a negative reading, which a reader really does report', () => {
    expect(at(writeWell('', 'D5', '-0.012'), 'D', 5)).toBe(-0.012)
  })

  it('clears a well when given blank text', () => {
    const cleared = writeWell(referencePlateText(), 'C1', '   ')
    expect(at(cleared, 'C', 1)).toBeNull()
    expect(cleared.split('\n')[2]?.startsWith(EMPTY_WELL_TOKEN)).toBe(true)
  })

  it('accepts a grid that arrives with row labels on it', () => {
    // The labels are stripped on the way in and not written back, so an edit lands in the well
    // the label named rather than one column to the right of it.
    const labelled = ['A\t1\t2', 'B\t3\t4'].join('\n')
    const written = writeWell(labelled, 'B2', '9')
    expect(at(written, 'B', 2)).toBe(9)
    expect(at(written, 'A', 1)).toBe(1)
  })

  it('returns the text untouched for a reference that is not a well', () => {
    expect(writeWell('kept', 'ZZ9', '1')).toBe('kept')
    expect(writeWell('kept', '', '1')).toBe('kept')
  })

  it('returns the text untouched for a well outside the plate', () => {
    expect(writeWell('kept', 'Z1', '1')).toBe('kept')
    expect(writeWell('kept', 'A13', '1')).toBe('kept')
    expect(writeWell('kept', 'A0', '1')).toBe('kept')
  })
})

/** Proves features/analysis/plate-grid-from-file.feature. */
describe('findGrid', () => {
  const row = (n: number, base: number) =>
    Array.from({ length: n }, (_, i) => (base + i * 0.1).toFixed(3)).join(',')
  const grid = (rows: number, cols: number) =>
    Array.from({ length: rows }, (_, r) => row(cols, 0.1 * r)).join('\n')
  const columnHeader = ',' + Array.from({ length: 12 }, (_, i) => i + 1).join(',')

  it('takes a bare grid whole', () => {
    const found = findGrid(grid(8, 12))
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.firstLine).toBe(1)
    expect(found.lastLine).toBe(8)
    expect(found.skippedAbove).toBe(0)
  })

  it('accepts the workbook plate, whose lower half is empty', () => {
    // The reason "8 by 12" counts cells and not readings: this plate is 24 numbers in a full
    // frame, and counting numbers would refuse the app's own worked example.
    const found = findGrid(referencePlateText())
    expect(found.ok).toBe(true)
  })

  it.each([
    ['a blank line between metadata and grid', 3, 'A,1\nB,2\nC,3\n\n'],
    ['no blank line at all', 2, 'Software Version,3.5.1\nWavelength,562nm\n'],
  ])('finds the grid under instrument metadata with %s', (_name, skipped, preamble) => {
    const found = findGrid(preamble + columnHeader + '\n' + grid(8, 12))
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.skippedAbove).toBe(skipped)
    expect(parsePlate(found.text).nRows).toBe(8)
  })

  it('refuses a file holding two reads rather than taking the first', () => {
    const refusal = findGrid(grid(8, 12) + '\n\n' + grid(8, 12))
    expect(refusal.ok).toBe(false)
    if (refusal.ok) return
    expect(refusal.kind).toBe('several')
    expect(refusal.message).toContain('2 grids')
  })

  it.each([
    [4, 12],
    [8, 11],
    [16, 12],
    [16, 24],
  ])('refuses a %i by %i grid, naming the shape it found', (rows, cols) => {
    const refusal = findGrid(grid(rows, cols))
    expect(refusal.ok).toBe(false)
    if (refusal.ok) return
    expect(refusal.kind).toBe('shape')
    expect(refusal.message).toContain(`${rows} by ${cols}`)
  })

  it.each([
    ['a file of prose', 'Software Version,3.5.1\nPlate,Read 1'],
    ['an empty file', ''],
    ['a single row, which is not a grid', row(12, 0.1)],
    ['a one-column column of numbers', '0.1\n0.2\n0.3'],
    ['a row label with nothing after it', 'A,0.1\nB,0.2'],
  ])('refuses %s as holding no grid', (_name, text) => {
    const refusal = findGrid(text)
    expect(refusal.ok).toBe(false)
    if (refusal.ok) return
    expect(refusal.kind).toBe('none')
    expect(refusal.message).toContain('no grid')
  })

  it('reads a grid that runs to the last line of the file', () => {
    const found = findGrid('Instrument,X\n' + grid(8, 12))
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.lastLine).toBe(9)
  })

  it.each(['-', 'NA', 'n/a', 'null', 'none', '#N/A', 'OVRFLW', 'overflow', '####', 'Saturated'])(
    'counts a row holding %s as part of the grid',
    (token) => {
      const withToken = [row(12, 0), `${token},` + row(11, 0.2), ...Array.from({ length: 6 }, (_, r) => row(12, 0.3 + r * 0.1))].join('\n')
      const found = findGrid(withToken)
      expect(found.ok).toBe(true)
    },
  )
})
