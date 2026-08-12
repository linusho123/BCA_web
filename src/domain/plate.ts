/**
 * Tolerant plate-reader output parser and file importer.
 *
 * Ported from BCA_quarto `src/bca/plate.py` (specdoc §6.3).
 *
 * The workbook's instruction is "paste, then Paste Special as values". A browser has no
 * paste-special, so this accepts whatever the instrument exported: tab-, comma- or
 * whitespace-delimited, with or without row-letter and column-number headers, and containing
 * sentinels such as OVRFLW.
 *
 * It never throws. An unreadable cell becomes null and gains an issue naming the exact well,
 * because a researcher pastes once and then edits, and a throw would blank the grid they are
 * editing rather than annotate the cell they are editing.
 */

import { PLATE_COLUMNS, PLATE_ROWS } from './constants'
import { type Issue, IssueCode, Severity, issue } from './errors'
import { num } from './format'

/** Instrument sentinels meaning "the detector saturated". Compared lower-cased. */
const OVERFLOW_TOKENS = new Set([
  'ovrflw',
  'overflow',
  'ovrflow',
  '####',
  '#####',
  'sat',
  'saturated',
])

/** Sentinels meaning "no measurement here", which is not the same as saturation. */
const MISSING_TOKENS = new Set(['-', '--', 'na', 'n/a', 'nan', 'null', 'none', '.', '#n/a'])

/**
 * A deliberately strict numeric grammar, which is NOT `Number()`.
 *
 * The differences bite on real paste data: `Number('')` is 0, `Number('0x10')` is 16, and
 * `Number('  12 ')` is 12. Accepting `0x10` as a well value would silently invent an
 * absorbance of 16 in a column where every other reading is under 3, and nothing downstream
 * would ever question it.
 */
const NUMERIC_RE = /^[+-]?(\d(_?\d)*(\.(\d(_?\d)*)?)?|\.\d(_?\d)*)(e[+-]?\d(_?\d)*)?$/i
const SPECIAL_RE = /^[+-]?(inf|infinity|nan)$/i

/** Parse a cell token, or return undefined when it is not a number at all. */
export function parseNumeric(token: string): number | undefined {
  if (SPECIAL_RE.test(token)) {
    if (/nan$/i.test(token)) return NaN
    return token.startsWith('-') ? -Infinity : Infinity
  }
  if (!NUMERIC_RE.test(token)) return undefined
  return Number(token.replace(/_/g, ''))
}

/** A parsed grid of absorbances. `null` means the well holds no usable reading. */
export interface PlateData {
  readonly values: ReadonlyArray<ReadonlyArray<number | null>>
  readonly nRows: number
  readonly nCols: number
  readonly rowLabels: readonly string[]
  readonly issues: readonly Issue[]
}

export interface ParsePlateOptions {
  expectedRows?: number
  expectedCols?: number
}

export const EMPTY_PLATE: PlateData = Object.freeze({
  values: [],
  nRows: 0,
  nCols: 0,
  rowLabels: [],
  issues: [],
})

/** What an un-plated well is written as. Matches what the readers in this lab emit. */
export const EMPTY_WELL_TOKEN = '-'

/** A grid located inside a file, with what surrounded it. */
export interface GridFound {
  readonly ok: true
  readonly text: string
  readonly firstLine: number
  readonly lastLine: number
  readonly skippedAbove: number
}

/** Why a file was not imported. `message` is what the researcher is shown. */
export interface GridRefusal {
  readonly ok: false
  readonly kind: 'none' | 'several' | 'shape'
  readonly message: string
}

/** Tokens a plate row may hold that are not numbers: un-plated wells and saturated detectors. */
const PLATE_ISH = /^(|-|na|n\/a|null|none|#n\/a|ovrflw|overflow|####|saturated)$/i

/**
 * Whether a line could be a row of a plate, as opposed to something an instrument printed.
 *
 * Every cell must be a reading, an un-plated well or a saturation sentinel — with one exception,
 * a leading single letter, which is how a reader labels the row. "Wavelength,562nm" fails on
 * "562nm"; ",1,2,3..." passes, because a column header is numeric and gets stripped later by
 * `parsePlate` along with the row letters.
 */
function isPlateRow(cells: readonly string[]): boolean {
  if (cells.length < 2) return false
  const body = /^[A-Za-z]$/.test(cells[0] as string) ? cells.slice(1) : cells
  if (body.length < 2) return false
  return body.every((cell) => parseNumeric(cell) !== undefined || PLATE_ISH.test(cell.trim()))
}

/**
 * Find the one grid in a file, or say why there isn't one.
 *
 * Reader exports are a grid wrapped in whatever the instrument felt like printing, so the grid
 * has to be located rather than assumed. What this will not do is choose: a file holding two
 * reads is refused, because taking the first would be a guess that looks exactly like a
 * successful import. Measured before the rule was written — two reads concatenate into a
 * plausible 16-row plate with the labels A to H twice, and every stage downstream computes on
 * it without complaint.
 *
 * "8 by 12" counts the grid's cells, not how many hold a number: the workbook's own plate is 24
 * readings in an 8 by 12 frame with rows E to H empty, and counting numbers would refuse it.
 */
export function findGrid(text: string): GridFound | GridRefusal {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')

  // Maximal runs of consecutive plate-ish lines. A blank line or a line of instrument prose
  // ends the run, which is what separates two reads in one file into two candidates.
  const runs: Array<{ first: number; last: number }> = []
  let start = -1
  lines.forEach((line, i) => {
    const isRow = line.trim() !== '' && isPlateRow(splitRow(line))
    if (isRow && start < 0) start = i
    if (!isRow && start >= 0) {
      if (i - start >= 2) runs.push({ first: start, last: i - 1 })
      start = -1
    }
  })
  if (start >= 0 && lines.length - start >= 2) {
    runs.push({ first: start, last: lines.length - 1 })
  }

  if (runs.length === 0) {
    return {
      ok: false,
      kind: 'none',
      message: 'no grid of absorbances was found in this file',
    }
  }
  if (runs.length > 1) {
    return {
      ok: false,
      kind: 'several',
      message:
        `this file holds ${runs.length} grids, and picking one for you would look exactly ` +
        'like a successful import. Save just the read you want and try again',
    }
  }

  const run = runs[0] as { first: number; last: number }
  const block = lines.slice(run.first, run.last + 1).join('\n')
  const parsed = parsePlate(block)
  if (parsed.nRows !== PLATE_ROWS.length || parsed.nCols !== PLATE_COLUMNS.length) {
    return {
      ok: false,
      kind: 'shape',
      message:
        `the grid in this file is ${parsed.nRows} by ${parsed.nCols}, not ` +
        `${PLATE_ROWS.length} by ${PLATE_COLUMNS.length}`,
    }
  }

  return {
    ok: true,
    text: block,
    firstLine: run.first + 1,
    lastLine: run.last + 1,
    skippedAbove: lines.slice(0, run.first).filter((l) => l.trim() !== '').length,
  }
}

/**
 * The grid as 8 by 12 cells of raw text, whatever shape the text arrived in.
 *
 * What the grid on screen renders, and what `writeWell` edits. Cells hold what a person typed
 * rather than what it parses to, so a saturated well still reads "OVRFLW" in the box it was
 * typed into, and a half-finished "0." survives until the next keystroke.
 *
 * An un-plated well comes back as the empty string rather than as `EMPTY_WELL_TOKEN`. The token
 * is how an empty well is *written* so the exported block stays rectangular; a box on screen
 * showing a dash would be claiming something was entered there.
 */
export function rawGrid(text: string): string[][] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim() !== '')
  const { rows } = stripLabels(lines.map(splitRow))

  return PLATE_ROWS.map((_row, rIndex) =>
    PLATE_COLUMNS.map((_col, cIndex) => {
      const cell = rows[rIndex]?.[cIndex]
      if (cell === undefined || cell === '' || cell === EMPTY_WELL_TOKEN) return ''
      return cell
    }),
  )
}

/**
 * Write one well back into the pasted grid, returning the new grid text.
 *
 * The inverse of `parsePlate`, and it lives here because it needs the same private knowledge of
 * how a row splits and where labels sit. It works on the *text* rather than on `PlateData` for
 * one reason: a cell holding "OVRFLW" parses to null, so a round trip through the parsed grid
 * would silently turn a saturated reading into an empty well and lose the issue that says so.
 * What a person typed is kept verbatim until something asks it for a number.
 *
 * An empty grid is seeded to the full 8 by 12 rather than growing to fit the well written. The
 * grid on screen is always a whole plate — a researcher typing into D5 first has not made a
 * four-row plate, they have made one entry in a 96-well one.
 *
 * A well outside the plate, or a reference that is not a well at all, returns the text
 * unchanged. There is no well to write to and nothing to report; the caller asked for a cell
 * that does not exist.
 */
export function writeWell(text: string, well: string, raw: string): string {
  const match = /^([A-Za-z])(\d{1,2})$/.exec(well.trim())
  if (!match) return text

  const rowLetter = (match[1] as string).toUpperCase()
  const r = (PLATE_ROWS as readonly string[]).indexOf(rowLetter)
  const c = Number(match[2]) - 1
  if (r < 0 || c < 0 || c >= PLATE_COLUMNS.length) return text

  const grid = rawGrid(text).map((cells) =>
    cells.map((cell) => (cell === '' ? EMPTY_WELL_TOKEN : cell)),
  )

  const entry = raw.trim()
  ;(grid[r] as string[])[c] = entry === '' ? EMPTY_WELL_TOKEN : entry

  return grid.map((cells) => cells.join('\t')).join('\n')
}

function makePlateData(
  values: ReadonlyArray<ReadonlyArray<number | null>>,
  nRows: number,
  nCols: number,
  rowLabels: readonly string[],
  issues: readonly Issue[],
): PlateData {
  return { values, nRows, nCols, rowLabels, issues }
}

/** Absorbance at a well named the way the plate is labelled, e.g. `wellValue(data, 'A', 1)`. */
export function wellValue(data: PlateData, rowLetter: string, colNumber: number): number | null {
  const r = data.rowLabels.indexOf(rowLetter.trim().toUpperCase())
  if (r < 0) return null
  if (!(colNumber >= 1 && colNumber <= data.nCols)) return null
  return (data.values[r] as ReadonlyArray<number | null>)[colNumber - 1] ?? null
}

/** All wells in one row, left to right. */
export function extractRow(data: PlateData, rowLetter: string): ReadonlyArray<number | null> {
  const r = data.rowLabels.indexOf(rowLetter.trim().toUpperCase())
  if (r < 0) return []
  return data.values[r] ?? []
}

/** All wells in one column, top to bottom. */
export function extractColumn(data: PlateData, colNumber: number): ReadonlyArray<number | null> {
  if (!(colNumber >= 1 && colNumber <= data.nCols)) return []
  return data.values.map((row) => row[colNumber - 1] ?? null)
}

/** Parse pasted plate-reader text into a grid of absorbances. Never throws. */
export function parsePlate(text: string, options: ParsePlateOptions = {}): PlateData {
  const { expectedRows = PLATE_ROWS.length, expectedCols = PLATE_COLUMNS.length } = options
  const issues: Issue[] = []

  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim() !== '')

  if (lines.length === 0) {
    issues.push(
      issue(
        IssueCode.EMPTY_INPUT,
        Severity.ERROR,
        "no plate data was provided; paste the reader's absorbance grid",
        'text',
      ),
    )
    return makePlateData([], 0, 0, [], issues)
  }

  const { rows, labels } = stripLabels(lines.map(splitRow))

  if (rows.length === 0 || rows.every((r) => r.length === 0)) {
    issues.push(
      issue(
        IssueCode.EMPTY_INPUT,
        Severity.ERROR,
        'the pasted text contained labels but no absorbance values',
        'text',
      ),
    )
    return makePlateData([], 0, 0, [], issues)
  }

  const widths = [...new Set(rows.map((r) => r.length))]
  const maxWidth = Math.max(...widths)
  if (widths.length > 1) {
    const offenders = rows
      .map((r, i) => (r.length !== maxWidth ? String(i + 1) : null))
      .filter((x): x is string => x !== null)
    issues.push(
      issue(
        IssueCode.RAGGED_ROWS,
        Severity.ERROR,
        `rows have differing numbers of cells ([${[...widths].sort((a, b) => a - b).join(', ')}]); ` +
          `row(s) ${offenders.join(', ')} do not match the widest row. ` +
          'Re-copy the block so every row has the same number of columns.',
        'text',
        { rows: offenders.join(',') },
      ),
    )
  }

  const nCols = maxWidth
  const nRows = rows.length
  const rowLabels = labels.length > 0 ? labels : defaultRowLabels(nRows)

  const values: Array<Array<number | null>> = []
  let readable = 0
  rows.forEach((row, rIndex) => {
    const parsed: Array<number | null> = []
    for (let cIndex = 0; cIndex < nCols; cIndex++) {
      const raw = row[cIndex] ?? ''
      const well = `${labelFor(rowLabels, rIndex)}${cIndex + 1}`
      const outcome = parseCell(raw, well)
      if (outcome.issue) issues.push(outcome.issue)
      if (outcome.value !== null) readable += 1
      parsed.push(outcome.value)
    }
    values.push(parsed)
  })

  // An un-plated well is not reported here, and that is a deliberate change from summarising
  // them into one line. The grid shows all 96 wells whether or not they hold anything, so a
  // note counting the empty ones is on every plate this app will ever see — permanent, since
  // most of a plate is normally empty, and unactionable, since nobody left those wells empty
  // by mistake. The empty well worth reporting is one inside a region somebody assigned, which
  // is work they declared and did not do; `mapSamples` and `readWells` raise that, naming the
  // sample it belongs to. Saturation and unreadable text are still named per well here, because
  // those are news about a well someone did plate.

  if (nRows !== expectedRows || nCols !== expectedCols) {
    issues.push(
      issue(
        IssueCode.UNEXPECTED_SHAPE,
        Severity.WARN,
        `parsed a ${nRows}x${nCols} block but expected ${expectedRows}x${expectedCols}; ` +
          'check that the whole plate was copied',
        'text',
        { cols: nCols, rows: nRows },
      ),
    )
  }

  // One error beats 96 warnings. A grid of nothing but sentinels is a single fact about the
  // read, and the per-well warnings underneath it are noise to scroll past.
  if (readable === 0) {
    issues.push(
      issue(
        IssueCode.NO_READABLE_CELLS,
        Severity.ERROR,
        'not one cell in the pasted block could be read as a number',
        'text',
      ),
    )
  }

  return makePlateData(values, nRows, nCols, rowLabels.slice(0, nRows), issues)
}

// --- helpers ---------------------------------------------------------------

/**
 * Split one line on tabs, commas, or runs of whitespace — whichever it uses.
 *
 * Tabs win over commas so a European export using "," as a decimal separator inside
 * tab-separated columns is not shredded into twice as many cells.
 */
function splitRow(line: string): string[] {
  let cells: string[]
  if (line.includes('\t')) {
    cells = line.split('\t')
  } else if (line.includes(',') && !looksDecimalComma(line)) {
    cells = line.split(',')
  } else {
    cells = splitWhitespace(line)
  }
  while (cells.length > 0 && (cells[cells.length - 1] as string).trim() === '') cells.pop()
  return cells.map((c) => c.trim())
}

function splitWhitespace(line: string): string[] {
  const trimmed = line.trim()
  return trimmed === '' ? [] : trimmed.split(/\s+/)
}

/**
 * True when the commas in this line are decimal points rather than separators.
 * "0,123 0,456" uses decimal commas; "0.1,0.2" does not. The tell is whitespace: a
 * decimal-comma line separates its columns with spaces.
 */
function looksDecimalComma(line: string): boolean {
  if (!/\s/.test(line.trim())) return false
  return splitWhitespace(line).every((token) => !token.includes(',') || isDecimalCommaToken(token))
}

function isDecimalCommaToken(token: string): boolean {
  const idx = token.indexOf(',')
  if (idx < 0) return false
  const head = token.slice(0, idx).replace(/^[+-]+/, '')
  const tail = token.slice(idx + 1)
  if (tail.includes(',')) return false
  return /^\d+$/.test(head) && /^\d+$/.test(tail)
}

/** Remove a column-number header row and a row-letter first column, if present. */
function stripLabels(input: string[][]): { rows: string[][]; labels: string[] } {
  let rows = input
  let labels: string[] = []

  const first = rows[0]
  if (first && isColumnHeader(first)) rows = rows.slice(1)

  if (rows.length > 0 && rows.every((r) => r.length > 0 && isRowLabel(r[0] as string))) {
    labels = rows.map((r) => (r[0] as string).trim().toUpperCase())
    rows = rows.map((r) => r.slice(1))
  }

  return { rows, labels }
}

/** A header is a run of consecutive small integers, optionally after a blank corner cell. */
function isColumnHeader(row: readonly string[]): boolean {
  const cells = row.filter((c) => c.trim() !== '')
  if (cells.length < 2) return false
  if (!cells.every((c) => /^\d+$/.test(c))) return false
  const numbers = cells.map((c) => parseInt(c, 10))
  const first = numbers[0] as number
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] !== first + i) return false
  }
  return (numbers[numbers.length - 1] as number) <= 48
}

/** A row label is one or two letters — "A" here, "AA" on a 384-well plate. */
function isRowLabel(cell: string): boolean {
  const stripped = cell.trim()
  return stripped.length >= 1 && stripped.length <= 2 && /^[A-Za-z]+$/.test(stripped)
}

function defaultRowLabels(nRows: number): string[] {
  if (nRows <= PLATE_ROWS.length) return PLATE_ROWS.slice(0, nRows)
  const extra: string[] = []
  for (let i = PLATE_ROWS.length; i < nRows; i++) extra.push(`R${i + 1}`)
  return [...PLATE_ROWS, ...extra]
}

function labelFor(labels: readonly string[], index: number): string {
  return labels[index] ?? `R${index + 1}`
}

interface CellOutcome {
  value: number | null
  issue: Issue | null
  /** An un-plated well: nothing was there to read, which is not the same as a failed read. */
  blank: boolean
}

/** Convert one cell to a number, classifying whatever cannot be converted. */
function parseCell(raw: string, well: string): CellOutcome {
  const token = raw.trim()
  const lowered = token.toLowerCase()

  if (token === '' || MISSING_TOKENS.has(lowered)) {
    return { value: null, issue: null, blank: true }
  }
  if (OVERFLOW_TOKENS.has(lowered)) {
    return {
      value: null,
      blank: false,
      issue: issue(
        IssueCode.OVERFLOW_CELL,
        Severity.WARN,
        `well ${well} reads "${token}": the detector saturated, so this well has no usable ` +
          'absorbance. Dilute the sample and re-read.',
        well,
      ),
    }
  }
  const candidate = isDecimalCommaToken(token) ? token.replace(/,/g, '.') : token
  const value = parseNumeric(candidate)

  if (value === undefined) {
    return {
      value: null,
      blank: false,
      issue: issue(
        IssueCode.NON_NUMERIC_CELL,
        Severity.WARN,
        `well ${well} reads "${token}", which is not a number`,
        well,
      ),
    }
  }
  if (!Number.isFinite(value)) {
    return {
      value: null,
      blank: false,
      issue: issue(
        IssueCode.NON_NUMERIC_CELL,
        Severity.WARN,
        `well ${well} reads "${token}", which is not a finite number`,
        well,
      ),
    }
  }
  if (value < 0) {
    // Kept, not discarded. A negative absorbance is a fact about the read that the researcher
    // has to see in order to judge it; hiding it would leave them wondering where a well went.
    return {
      value,
      blank: false,
      issue: issue(
        IssueCode.NEGATIVE_ABSORBANCE,
        Severity.WARN,
        `well ${well} is negative (${num(value)}); the reader was probably blanked against a ` +
          'well darker than this one. The value is kept but should be checked.',
        well,
      ),
    }
  }

  return { value, issue: null, blank: false }
}

// --- file import -----------------------------------------------------------

/**
 * Leading bytes of the formats a user is most likely to reach for by mistake.
 *
 * .xlsx and .docx are both zip archives and share the PK signature, so the message names the
 * common case rather than guessing between them.
 */
const BINARY_SIGNATURES: ReadonlyArray<readonly [readonly number[], string]> = [
  [[0x50, 0x4b, 0x03, 0x04], 'an .xlsx or other zipped workbook'],
  [[0xd0, 0xcf, 0x11, 0xe0], 'a legacy Excel workbook (.xls)'],
  [[0x25, 0x50, 0x44, 0x46], 'a PDF'],
  [[0x89, 0x50, 0x4e, 0x47], 'a PNG image'],
  [[0xff, 0xd8, 0xff], 'a JPEG image'],
]

function binaryFormat(bytes: Uint8Array): string | null {
  for (const [signature, description] of BINARY_SIGNATURES) {
    if (bytes.length < signature.length) continue
    if (signature.every((byte, i) => bytes[i] === byte)) return description
  }
  return null
}

/**
 * Decode an uploaded file to text, tolerating what spreadsheets actually emit.
 *
 * Three encodings in order: UTF-8 with a byte order mark first, because Excel's "CSV UTF-8"
 * writes one and a plain decode leaves it glued to the first cell; plain UTF-8 next; cp1252
 * last, which is what Excel on Windows writes by default. cp1252 is the fallback rather than a
 * candidate precisely because it decodes any byte sequence without complaint.
 */
export function decodePlateBytes(bytes: Uint8Array): { text: string; issues: Issue[] } {
  const issues: Issue[] = []

  // Checked before decoding. cp1252 maps every byte to some character, so a workbook dropped
  // here would decode into a page of mojibake and produce dozens of NON_NUMERIC_CELL warnings
  // that never once mention the actual problem.
  const kind = binaryFormat(bytes)
  if (kind !== null) {
    issues.push(
      issue(
        IssueCode.BINARY_UPLOAD,
        Severity.ERROR,
        `this looks like ${kind}, not a text export. Open it and use File > Save As > CSV, ` +
          'or copy the block of numbers and paste it instead.',
        'file',
        { format: kind },
      ),
    )
    return { text: '', issues }
  }

  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
    return { text: decoder.decode(bytes), issues }
  } catch {
    // Not valid UTF-8; fall through to cp1252.
  }
  try {
    const decoder = new TextDecoder('windows-1252', { fatal: false })
    return { text: decoder.decode(bytes), issues }
  } catch {
    issues.push(
      issue(
        IssueCode.UNDECODABLE_UPLOAD,
        Severity.ERROR,
        'the uploaded file is not readable as text; export it as CSV and try again',
        'file',
      ),
    )
    return { text: '', issues }
  }
}

/**
 * Parse an uploaded CSV or text export into a grid of absorbances.
 *
 * A thin decoding shell over `parsePlate`. Leading non-tabular lines are deliberately not
 * stripped: a reader that prefixes its export with instrument metadata produces a RAGGED_ROWS
 * error naming the offending rows, which tells the user exactly what to delete. Silently
 * discarding leading lines could just as easily discard the first row of data.
 */
export function parsePlateCsv(
  raw: string | Uint8Array,
  options: ParsePlateOptions = {},
): PlateData {
  const decoded = typeof raw === 'string' ? { text: raw, issues: [] as Issue[] } : decodePlateBytes(raw)

  if (decoded.text.trim() === '') {
    // An undecodable or binary file already carries its own explanation; adding "contained no
    // data" on top of it would describe the symptom over the cause.
    if (decoded.issues.length === 0) {
      decoded.issues.push(
        issue(IssueCode.EMPTY_INPUT, Severity.ERROR, 'the uploaded file contained no data', 'file'),
      )
    }
    return makePlateData([], 0, 0, [], decoded.issues)
  }

  const data = parsePlate(decoded.text, options)
  if (decoded.issues.length === 0) return data
  return makePlateData(data.values, data.nRows, data.nCols, data.rowLabels, [
    ...decoded.issues,
    ...data.issues,
  ])
}
