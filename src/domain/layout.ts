/**
 * Plate-well to standard/sample mapping.
 *
 * Ported from BCA_quarto `src/bca/layout.py` (specdoc §5.7, §6.3).
 *
 * The mapping is expressed as well regions — "A1:A9" for the standards, "C1:C3" for a sample —
 * because that is how a plate is described on paper and in a lab notebook. A region is parsed
 * into explicit well labels, and each label is looked up through the parsed plate, which
 * already returns null for anything absent or unreadable.
 *
 * Two properties matter more than convenience here.
 *
 * Nothing throws. A mistyped region is an issue in the returned array, so a bad character in
 * one field degrades that panel rather than blanking the page.
 *
 * Overlap is an error, not a warning. A well assigned to both a standard and a sample yields a
 * curve and a result that are each individually plausible and jointly wrong, with nothing in
 * the output to suggest it — exactly the failure this project exists to make visible.
 */

import { type Issue, IssueCode, Severity, hasErrors, issue } from './errors'
import { type PlateData, extractRow, wellValue } from './plate'
import { type StandardLevel, standardLevel } from './curve'
import type { SampleInput } from './samples'

const RANGE_SEP = ':'
const LIST_SEP = ','

/**
 * The longest span accepted along one axis. A 384-well plate is 16 x 24, so nothing legitimate
 * exceeds this. The cap exists because a span is expanded eagerly: without it the typo
 * `A1:A100000` — one keystroke away from `A1:A10` — builds a hundred thousand labels and looks
 * up every one of them on each keystroke, inside a reactive chain.
 */
const MAX_SPAN = 24

/** Row C is the first sample row: A holds the standards and B their second read. */
const FIRST_SAMPLE_ROW_INDEX = 2
const DEFAULT_N_STANDARDS = 9

/** ("a", 3) -> "A3". The canonical spelling used in issues and lookups. */
export function wellLabel(row: string, column: number): string {
  return `${row.trim().toUpperCase()}${column}`
}

/**
 * "A10" -> ["A", 10]; null when the token is not a well reference.
 *
 * A single leading letter followed by digits, with a column of at least 1. Multi-letter rows
 * (AA1) belong to plates larger than 384 wells, which this app does not handle, so they are
 * rejected here rather than silently mis-parsed.
 */
function splitWell(token: string): [string, number] | null {
  const text = token.trim().toUpperCase()
  if (text.length < 2) return null
  const row = text[0] as string
  if (!/^[A-Z]$/.test(row)) return null
  const rest = text.slice(1)
  if (!/^\d+$/.test(rest)) return null
  const column = parseInt(rest, 10)
  // Column 0 exists on no plate. Rejecting it at parse time reports "A0 is not a well
  // reference", which is the truth; letting it through reports "A0 is outside the plate",
  // which invites the user to look for a bigger plate.
  if (column < 1) return null
  return [row, column]
}

/**
 * Wells covered by `start:end`.
 *
 * A span runs along one axis only. A1:A9 walks a row, A1:H1 walks a column, and a rectangular
 * span like A1:B9 is rejected — a rectangle has no unambiguous order, and the order is exactly
 * what pairs wells with concentrations.
 */
function expandSpan(start: string, end: string): { wells: string[]; error: string | null } {
  const first = splitWell(start)
  const last = splitWell(end)
  if (first === null || last === null) {
    const bad = (first === null ? start : end).trim()
    return { wells: [], error: `"${bad}" is not a well reference such as A1` }
  }

  const [rowA, colA] = first
  const [rowB, colB] = last

  if (rowA === rowB) {
    const span = Math.abs(colB - colA) + 1
    if (span > MAX_SPAN) {
      return {
        wells: [],
        error:
          `${start.trim().toUpperCase()}:${end.trim().toUpperCase()} covers ${span} wells; ` +
          `no plate row is that long (the largest handled here is ${MAX_SPAN})`,
      }
    }
    const step = colB >= colA ? 1 : -1
    const wells: string[] = []
    for (let c = colA; step > 0 ? c <= colB : c >= colB; c += step) wells.push(wellLabel(rowA, c))
    return { wells, error: null }
  }

  if (colA === colB) {
    const codeA = rowA.charCodeAt(0)
    const codeB = rowB.charCodeAt(0)
    const step = codeB >= codeA ? 1 : -1
    const wells: string[] = []
    for (let code = codeA; step > 0 ? code <= codeB : code >= codeB; code += step) {
      wells.push(wellLabel(String.fromCharCode(code), colA))
    }
    return { wells, error: null }
  }

  return {
    wells: [],
    error:
      `${start.trim().toUpperCase()}:${end.trim().toUpperCase()} spans both rows and columns; ` +
      'a region must run along a single row or a single column',
  }
}

/**
 * Well labels named by a region string. Never throws.
 *
 * "A1:A9" and "A1, A2, A3" are both accepted, as is "A1:A3, C1". Duplicates within one region
 * are collapsed keeping first-seen order: repeating a well inside a single region is a typo
 * rather than a claim about replicates, and silently double-weighting it would bias the mean.
 */
export function parseRegion(
  text: string,
  field?: string,
): { wells: string[]; issues: Issue[] } {
  const issues: Issue[] = []
  if (text.trim() === '') {
    issues.push(
      issue(
        IssueCode.EMPTY_REGION,
        Severity.ERROR,
        'no wells were given; name a region such as A1:A9',
        field,
      ),
    )
    return { wells: [], issues }
  }

  const wells: string[] = []
  const seen = new Set<string>()

  for (const part of text.split(LIST_SEP)) {
    const chunk = part.trim()
    if (chunk === '') continue

    let expanded: string[]
    const sepAt = chunk.indexOf(RANGE_SEP)
    if (sepAt >= 0) {
      const result = expandSpan(chunk.slice(0, sepAt), chunk.slice(sepAt + 1))
      if (result.error !== null) {
        issues.push(
          issue(IssueCode.BAD_REGION_SYNTAX, Severity.ERROR, result.error, field, {
            region: chunk,
          }),
        )
        continue
      }
      expanded = result.wells
    } else {
      const parsed = splitWell(chunk)
      if (parsed === null) {
        issues.push(
          issue(
            IssueCode.BAD_REGION_SYNTAX,
            Severity.ERROR,
            `"${chunk}" is not a well reference such as A1 or a span such as A1:A9`,
            field,
            { region: chunk },
          ),
        )
        continue
      }
      expanded = [wellLabel(parsed[0], parsed[1])]
    }

    for (const well of expanded) {
      if (seen.has(well)) continue
      seen.add(well)
      wells.push(well)
    }
  }

  if (wells.length === 0 && issues.length === 0) {
    issues.push(
      issue(
        IssueCode.EMPTY_REGION,
        Severity.ERROR,
        'no wells were given; name a region such as A1:A9',
        field,
      ),
    )
  }
  return { wells, issues }
}

/**
 * Well labels to the region string that names them — the inverse of `parseRegion`.
 *
 * Selecting wells by clicking the plate produces a set of labels, while `mapSamples` takes a
 * region string. This is that adapter, and it is written to be the inverse rather than merely a
 * formatter: `parseRegion(wellsToRegion(w))` yields the same wells as `w`, deduplicated and in
 * canonical order. That round-trip is what lets the clicked highlight and the text the user
 * reads back be the same fact rather than two representations free to disagree.
 *
 * Canonical order is row letter, then column ascending — not click order. The region is shown
 * to the user as a description of which wells are a sample's, and "C1:C3" is that description;
 * "C3, C1, C2" is a record of how the mouse moved. Replicates are averaged, so the order within
 * a sample carries no arithmetic.
 *
 * A token that is not a well reference passes through verbatim rather than being dropped, so
 * `parseRegion` reports it downstream instead of it vanishing between the two.
 */
export function wellsToRegion(wells: readonly string[]): string {
  const byRow = new Map<string, number[]>()
  const seen = new Set<string>()
  const passthrough: string[] = []

  for (const token of wells) {
    const text = token.trim()
    if (text === '') continue
    const parsed = splitWell(text)
    if (parsed === null) {
      if (!seen.has(text)) {
        seen.add(text)
        passthrough.push(text)
      }
      continue
    }
    const label = wellLabel(parsed[0], parsed[1])
    if (seen.has(label)) continue
    seen.add(label)
    const row = byRow.get(parsed[0])
    if (row) row.push(parsed[1])
    else byRow.set(parsed[0], [parsed[1]])
  }

  const span = (row: string, start: number, end: number): string =>
    start === end ? wellLabel(row, start) : `${wellLabel(row, start)}${RANGE_SEP}${wellLabel(row, end)}`

  const parts: string[] = []
  for (const row of [...byRow.keys()].sort()) {
    const columns = [...(byRow.get(row) as number[])].sort((a, b) => a - b)
    let start = columns[0] as number
    let previous = start
    for (const column of columns.slice(1)) {
      if (column === previous + 1) {
        previous = column
        continue
      }
      parts.push(span(row, start, previous))
      start = column
      previous = column
    }
    parts.push(span(row, start, previous))
  }

  return [...parts, ...passthrough].join(`${LIST_SEP} `)
}

/**
 * How many wells of `row`, counting from column 1, hold a usable absorbance.
 *
 * The run stops at the first unreadable well rather than counting every readable one in the
 * row. A gap is meaningful: three replicates in C1:C3 and a stray note in C7 is a plate with
 * three replicates, and treating the span as C1:C7 would feed four blanks into the mean.
 */
function readableRun(data: PlateData, row: string, limit: number): number {
  const values = extractRow(data, row).slice(0, limit)
  let count = 0
  for (const value of values) {
    if (value === null) break
    count += 1
  }
  return count
}

export interface DefaultLayout {
  readonly standardRegions: readonly string[]
  readonly assignments: ReadonlyArray<readonly [string, string]>
  readonly issues: readonly Issue[]
}

export interface DefaultLayoutOptions {
  nStandards?: number
  field?: string
}

/**
 * The fixed layout this assay is run on, expressed as regions.
 *
 * Row A holds the standard series, row B its second read, and each row from C down holds one
 * sample. That is a property of the plate, not something a user should restate on every run.
 *
 * Rather than a second mapping path, this returns exactly the arguments `mapStandards` and
 * `mapSamples` already take. The regions it generates are the regions a user would have typed,
 * so everything downstream — ordering, overlap detection, out-of-bounds reporting — is code
 * that was already there and already tested.
 *
 * Two things are inferred from the plate rather than asked for.
 *
 * Row B joins the standards only when it holds a readable well. A single-read plate is the
 * ordinary case, and a row of nine nulls would otherwise be averaged into every level, turning
 * a clean single read into one that looks half missing.
 *
 * A sample's replicate count is the readable run of its row. Whatever was plated is what is
 * read: three wells or six, with no second field to keep in sync with the pipetting.
 */
export function defaultLayout(
  data: PlateData,
  sampleNames: readonly string[],
  options: DefaultLayoutOptions = {},
): DefaultLayout {
  const { nStandards = DEFAULT_N_STANDARDS, field = 'sampleNames' } = options
  const issues: Issue[] = []

  const standardRegions: string[] = []
  if (readableRun(data, 'A', nStandards) > 0) standardRegions.push(`A1:A${nStandards}`)
  if (readableRun(data, 'B', nStandards) > 0) standardRegions.push(`B1:B${nStandards}`)

  // A name's position in the list is its row, so a blank entry holds its row open rather than
  // letting the names below it slide up. Both readings can be wrong, but they fail differently:
  // holding the row produces a sample mapped to an empty row, which is a visible warning, while
  // sliding up maps a sample onto another sample's wells and reports nothing at all.
  const availableRows = data.rowLabels.slice(FIRST_SAMPLE_ROW_INDEX)
  const assignments: Array<readonly [string, string]> = []

  sampleNames.forEach((rawName, index) => {
    const name = rawName.trim()
    if (name === '') return

    if (index >= availableRows.length) {
      issues.push(
        issue(
          IssueCode.REGION_OUT_OF_BOUNDS,
          Severity.ERROR,
          `"${name}" is sample ${index + 1}, but this plate has only ${availableRows.length} ` +
            'row(s) below the standards; name fewer samples or set the layout by hand',
          field,
          { row: index + 1, rowsAvailable: availableRows.length },
        ),
      )
      return
    }

    const row = availableRows[index] as string
    const width = readableRun(data, row, data.nCols)
    if (width === 0) {
      issues.push(
        issue(
          IssueCode.UNREADABLE_WELL_IN_REGION,
          Severity.WARN,
          `row ${row} holds no usable absorbance, so "${name}" was not mapped`,
          field,
          { row, sample: name },
        ),
      )
      return
    }
    assignments.push([name, `${row}1:${row}${width}`] as const)
  })

  return { standardRegions, assignments, issues }
}

/**
 * Absorbances for `wells`, reporting those outside the plate or unreadable.
 *
 * Off-plate and unreadable are separate codes on purpose. A well outside the parsed grid means
 * the region is wrong; an unreadable well means the region is right and the instrument had
 * nothing to give. The first is a layout mistake, the second is data.
 */
function readWells(
  data: PlateData,
  wells: readonly string[],
  field?: string,
): { values: Array<number | null>; issues: Issue[] } {
  const issues: Issue[] = []
  const values: Array<number | null> = []

  for (const label of wells) {
    const parsed = splitWell(label)
    if (parsed === null) {
      values.push(null)
      continue
    }
    const [row, column] = parsed
    const inBounds = data.rowLabels.includes(row) && column >= 1 && column <= data.nCols
    if (!inBounds) {
      issues.push(
        issue(
          IssueCode.REGION_OUT_OF_BOUNDS,
          Severity.ERROR,
          `well ${label} is outside the parsed ${data.nRows}x${data.nCols} plate`,
          field,
          { well: label },
        ),
      )
      values.push(null)
      continue
    }

    const value = wellValue(data, row, column)
    if (value === null) {
      issues.push(
        issue(
          IssueCode.UNREADABLE_WELL_IN_REGION,
          Severity.WARN,
          `well ${label} has no usable absorbance and was excluded`,
          field,
          { well: label },
        ),
      )
    }
    values.push(value)
  }
  return { values, issues }
}

export interface MapStandardsOptions {
  tubeIds?: readonly string[]
  field?: string
}

/**
 * Build `StandardLevel`s from one region per replicate.
 *
 * Each entry in `regions` is one read across the whole standard series — the way a plate reader
 * lays them out, a row per replicate and a column per tube. Two regions therefore mean duplicate
 * standards, and the nth well of every region is the nth concentration.
 *
 * An error-severity issue withholds the levels entirely. The standards feed one fit, and a fit
 * computed from a region that is partly off the plate is a curve built from phantom wells.
 */
export function mapStandards(
  data: PlateData,
  regions: readonly string[],
  concentrations: readonly number[],
  options: MapStandardsOptions = {},
): { levels: StandardLevel[]; issues: Issue[] } {
  const { tubeIds = [], field = 'standardsRegion' } = options
  const issues: Issue[] = []

  if (concentrations.length === 0) {
    issues.push(
      issue(
        IssueCode.EMPTY_INPUT,
        Severity.ERROR,
        'no standard concentrations were given',
        'standardConcs',
      ),
    )
    return { levels: [], issues }
  }

  const replicateRows: Array<Array<number | null>> = []
  regions.forEach((region, index) => {
    const parsed = parseRegion(region, field)
    issues.push(...parsed.issues)
    if (parsed.wells.length === 0) return

    if (parsed.wells.length !== concentrations.length) {
      issues.push(
        issue(
          IssueCode.REGION_LENGTH_MISMATCH,
          Severity.ERROR,
          `replicate ${index + 1} covers ${parsed.wells.length} well(s) but ` +
            `${concentrations.length} concentration(s) were given; the nth well is the nth ` +
            'standard, so the counts must match',
          field,
          { concentrations: concentrations.length, replicate: index + 1, wells: parsed.wells.length },
        ),
      )
      return
    }

    const read = readWells(data, parsed.wells, field)
    issues.push(...read.issues)
    replicateRows.push(read.values)
  })

  if (replicateRows.length === 0) {
    issues.push(
      issue(IssueCode.EMPTY_INPUT, Severity.ERROR, 'no usable standard region was given', field),
    )
    return { levels: [], issues }
  }

  if (hasErrors(issues)) return { levels: [], issues }

  const levels = concentrations.map((conc, index) =>
    standardLevel(
      conc,
      replicateRows.map((row) => row[index] ?? null),
      tubeIds[index] ?? null,
    ),
  )
  return { levels, issues }
}

export interface MapSamplesOptions {
  field?: string
}

/**
 * Build `SampleInput`s from [name, region] pairs.
 *
 * Unlike standards, every well in a sample's region is a replicate of that one sample, so the
 * region length is free — one well or six, whatever was plated. A sample that cannot be mapped
 * is skipped and reported, and the samples around it still map: they are independent rows, so
 * withholding all of them for one bad region would be punishing the wrong ones.
 */
export function mapSamples(
  data: PlateData,
  assignments: ReadonlyArray<readonly [string, string]>,
  options: MapSamplesOptions = {},
): { samples: SampleInput[]; issues: Issue[] } {
  const { field = 'sampleRegion' } = options
  const issues: Issue[] = []
  const samples: SampleInput[] = []

  for (const [name, region] of assignments) {
    const label = name.trim()
    if (label === '') {
      issues.push(
        issue(
          IssueCode.UNNAMED_SAMPLE,
          Severity.ERROR,
          `a sample assigned to "${region}" has no name`,
          field,
          { region },
        ),
      )
      continue
    }

    const parsed = parseRegion(region, field)
    issues.push(...parsed.issues)
    if (parsed.wells.length === 0) continue

    const read = readWells(data, parsed.wells, field)
    issues.push(...read.issues)
    samples.push({ name: label, replicates: read.values })
  }

  return { samples, issues }
}

export interface CheckOverlapOptions {
  field?: string
}

/**
 * Report wells claimed by more than one region.
 *
 * Assigning one well to both a standard and a sample produces a curve and a concentration that
 * are each individually plausible and jointly wrong, with nothing in the output to suggest it.
 * Reported at error severity: the numbers downstream are unusable until the layout is fixed.
 */
export function checkOverlap(
  standardRegions: readonly string[],
  sampleAssignments: ReadonlyArray<readonly [string, string]>,
  options: CheckOverlapOptions = {},
): Issue[] {
  const { field = 'regions' } = options
  const owners = new Map<string, string[]>()

  const claim = (well: string, claimant: string): void => {
    const existing = owners.get(well)
    if (existing) existing.push(claimant)
    else owners.set(well, [claimant])
  }

  standardRegions.forEach((region, index) => {
    for (const well of parseRegion(region, field).wells) {
      claim(well, `standards replicate ${index + 1}`)
    }
  })
  for (const [name, region] of sampleAssignments) {
    for (const well of parseRegion(region, field).wells) {
      claim(well, `sample ${name.trim() || '(unnamed)'}`)
    }
  }

  const issues: Issue[] = []
  for (const well of [...owners.keys()].sort()) {
    const claimants = owners.get(well) as string[]
    if (claimants.length > 1) {
      issues.push(
        issue(
          IssueCode.OVERLAPPING_REGIONS,
          Severity.ERROR,
          `well ${well} is claimed by ${claimants.join(' and ')}; one well cannot be both a ` +
            'standard and an unknown',
          field,
          { claimants: claimants.length, well },
        ),
      )
    }
  }
  return issues
}
