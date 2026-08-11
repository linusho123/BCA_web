/**
 * Proves the four features in features/plate/: reading a pasted grid, importing the reader's
 * exported file, mapping wells to standards and samples, and deriving the lab's usual layout.
 *
 * All four turn on one object — the parsed `PlateData` — so they share the fixtures that build
 * one. A grid is built as text and parsed, never assembled as a `PlateData` literal: the tolerance
 * for delimiters, labels and sentinels is the thing under test in the first feature and the thing
 * the other three are entitled to assume, and a hand-built literal would let them assume it
 * without anyone having proved it.
 */

import { expect } from 'vitest'
import { Given, When, Then } from 'quickpickle'
import {
  type World,
  expectIssue,
  expectNoIssues,
  number,
  numberList,
} from '../support/world'
import { PLATE_ROWS, PLATE_LOAD_ROUTES, PLATE_LOAD_ROUTE_THAT_OPENS } from '~/domain/constants'
import { type Issue } from '~/domain/errors'
import {
  type PlateData,
  EMPTY_PLATE,
  extractColumn,
  extractRow,
  parsePlate,
  parsePlateCsv,
  wellValue,
} from '~/domain/plate'
import {
  checkOverlap,
  defaultLayout,
  mapSamples,
  mapStandards,
  parseRegion,
  wellsToRegion,
} from '~/domain/layout'
import { fitCurve } from '~/domain/curve'
import {
  REFERENCE_ABSORBANCES,
  REFERENCE_CONCENTRATIONS,
  REFERENCE_TUBE_IDS,
  referenceFit,
} from '~/domain/reference'
import { StoredSessionSchema } from '~/schemas/session'

const N_ROWS = 8
const N_COLS = 12

// --- fixtures --------------------------------------------------------------

/**
 * An 8x12 grid of absorbances, every well populated and every value different.
 *
 * Distinct values are what let "well A1 holds the first value" mean anything: on a grid of one
 * repeated number, a parser that transposed the plate or dropped a row would still pass.
 */
function gridCells(): string[][] {
  return Array.from({ length: N_ROWS }, (_, r) =>
    Array.from({ length: N_COLS }, (_, c) => ((5 + r * N_COLS + c) / 100).toFixed(2)),
  )
}

/**
 * Join a grid the way the delimiter is named in the feature.
 *
 * The space-separated form uses runs of two to four spaces rather than one, because that is what
 * a reader emits when it aligns its columns, and a single space is the case a naive `split(' ')`
 * would already handle.
 */
function gridText(cells: readonly (readonly string[])[], delimiter = 'tabs'): string {
  const join = (row: readonly string[]): string => {
    if (delimiter === 'tabs') return row.join('\t')
    if (delimiter === 'commas') return row.join(',')
    if (delimiter === 'runs of spaces') {
      return row.map((cell, i) => (i === 0 ? cell : ' '.repeat(2 + (i % 3)) + cell)).join('')
    }
    throw new Error(`"${delimiter}" is not a delimiter this fixture knows how to write`)
  }
  return cells.map(join).join('\n')
}

/** The workbook's own plate: two populated rows of eleven columns, tab separated. */
const RIPA_PLATE_TEXT = [
  '0.132\t0.159\t0.262\t0.391\t0.636\t0.895\t1.125\t1.479\t2.051\t0.43\t0.36',
  '0.130\t0.161\t0.259\t0.388\t0.640\t0.891\t1.130\t1.475\t2.049\t0.44\t0.35',
].join('\n')

/**
 * A whole plate written from named rows, with un-plated wells as "-".
 *
 * The layout scenarios describe a plate by what its rows hold — "the standard series in row A",
 * "row C holding two readings" — so the fixture takes that shape directly. "-" rather than an
 * empty cell because an empty trailing cell is stripped as padding, which would make a row that
 * ends early indistinguishable from a row that is short.
 */
function plateFrom(rows: Record<string, ReadonlyArray<number | null>>): PlateData {
  const text = PLATE_ROWS.map((row) => {
    const values = rows[row] ?? []
    return Array.from({ length: N_COLS }, (_, c) => {
      const value = values[c]
      return value === undefined || value === null ? '-' : String(value)
    }).join('\t')
  }).join('\n')
  return parsePlate(text)
}

const THREE_REPLICATES = [0.43, 0.43, 0.43]

/** Build the plate the scenario has described so far, re-parsing on every added row. */
function withRows(world: World, added: Record<string, ReadonlyArray<number | null>>): void {
  type Rows = Record<string, ReadonlyArray<number | null>>
  const rows = { ...((world.plateRows as Rows | undefined) ?? {}), ...added }
  world.plateRows = rows
  world.plate = plateFrom(rows)
}

// --- accessors -------------------------------------------------------------

function plate(world: World): PlateData {
  const data = world.plate as PlateData | undefined
  if (data === undefined) {
    throw new Error('no plate has been parsed; check that a Given built one and a When parsed it')
  }
  return data
}

/** An issue's context as a map, which is how the numbers in it are meant to be read. */
function context(found: Issue): Map<string, string> {
  return new Map(found.context)
}

/**
 * Assert an issue names something — a well, a sample, a format.
 *
 * The name is looked for in the message and in the context rather than in one fixed place,
 * because what "naming" means differs by issue: a cell issue carries the well as its field, a
 * layout issue carries the sample in its context, and both say it in the sentence the researcher
 * reads. Requiring one particular carrier would be asserting the implementation.
 */
function expectNames(found: Issue, name: string): void {
  const carried = [found.field ?? '', found.message, ...[...context(found).values()]]
  expect(
    carried.some((text) => text.includes(name)),
    `expected ${found.code} to name "${name}"; it said "${found.message}"`,
  ).toBe(true)
}

// --- parsing ---------------------------------------------------------------

Given('an 8x12 grid of absorbances separated by {}', (world: World, delimiter: string) => {
  world.cells = gridCells()
  world.plateText = gridText(world.cells as string[][], delimiter)
})

Given('an 8x12 grid labelled with row letters and a column number header', (world: World) => {
  const cells = gridCells()
  world.cells = cells
  const header = ['', ...Array.from({ length: N_COLS }, (_, c) => String(c + 1))]
  const body = cells.map((row, r) => [PLATE_ROWS[r] as string, ...row])
  world.plateText = gridText([header, ...body])
})

Given('an 8x12 grid of absorbances padded with blank lines and trailing tabs', (world: World) => {
  const cells = gridCells()
  world.cells = cells
  // The padding a reader adds around its export: blank lines either side and a trailing tab on
  // every row, which is what an empty thirteenth column looks like on the clipboard.
  world.plateText = `\n\n${gridText(cells).replace(/\n/g, '\t\n')}\t\n\n`
})

Given('an 8x12 grid whose well {string} reads {string}', (world: World, well: string, token: string) => {
  const cells = gridCells()
  const row = PLATE_ROWS.indexOf(well[0] as (typeof PLATE_ROWS)[number])
  const column = number(well.slice(1)) - 1
  ;(cells[row] as string[])[column] = token
  world.cells = cells
  world.plateText = gridText(cells)
})

Given('an 8x12 grid entirely of {string}', (world: World, token: string) => {
  world.plateText = gridText(
    Array.from({ length: N_ROWS }, () => Array.from({ length: N_COLS }, () => token)),
  )
})

Given("the workbook's RIPA plate of 2 rows by 11 columns", (world: World) => {
  world.plateText = RIPA_PLATE_TEXT
})

Given('a plate paste of {}', (world: World, kind: string) => {
  const pastes: Record<string, string> = {
    'an empty string': '',
    'only whitespace': '   \t  \n   ',
    'only blank lines': '\n\n\n',
  }
  const text = pastes[kind]
  if (text === undefined) throw new Error(`"${kind}" is not a paste this fixture knows`)
  world.plateText = text
})

/** Rows of 12, 11 and 12 cells — the shape a half-selected copy produces. */
function raggedRows(): string[][] {
  const cells = gridCells().slice(0, 3)
  return cells.map((row, r) => (r === 1 ? row.slice(0, N_COLS - 1) : [...row]))
}

Given('a grid whose rows hold 12, 11 and 12 cells', (world: World) => {
  world.plateText = gridText(raggedRows(), 'commas')
})

Given('a column number header above rows holding 12, 11 and 12 cells', (world: World) => {
  // Labelled rows under the header, because the header is only stripped when what follows looks
  // like a plate — and the point of the scenario is that stripping it does not hide the short row.
  const header = ['', ...Array.from({ length: N_COLS }, (_, c) => String(c + 1))]
  const body = raggedRows().map((row, r) => [PLATE_ROWS[r] as string, ...row])
  world.plateText = gridText([header, ...body])
})

When('the plate text is parsed', (world: World) => {
  world.plate = parsePlate(world.plateText as string)
})

Then('the plate is {int} rows by {int} columns', (world: World, rows: number, columns: number) => {
  const data = plate(world)
  expect([data.nRows, data.nCols], 'the parsed shape').toEqual([rows, columns])
})

Then('well {string} holds the first value of the grid', (world: World, well: string) => {
  const first = ((world.cells as string[][])[0] as string[])[0] as string
  expect(wellValue(plate(world), well[0] as string, number(well.slice(1)))).toBe(number(first))
})

Then('well {string} holds a number', (world: World, well: string) => {
  const value = wellValue(plate(world), well[0] as string, number(well.slice(1)))
  expect(typeof value, `well ${well}`).toBe('number')
})

Then(/^well "([^"]+)" holds (-?[\d.]+)$/, (world: World, well: string, expected: string) => {
  expect(wellValue(plate(world), well[0] as string, number(well.slice(1)))).toBe(number(expected))
})

Then('well {string} is empty', (world: World, well: string) => {
  expect(wellValue(plate(world), well[0] as string, number(well.slice(1))), well).toBeNull()
})

Then('the row labels are {string} through {string}', (world: World, first: string, last: string) => {
  const wanted = PLATE_ROWS.slice(PLATE_ROWS.indexOf(first as 'A'), PLATE_ROWS.indexOf(last as 'H') + 1)
  expect(plate(world).rowLabels).toEqual([...wanted])
})

Then('row {string} holds {int} values', (world: World, row: string, count: number) => {
  expect(extractRow(plate(world), row)).toHaveLength(count)
})

Then('column {int} holds {int} values', (world: World, column: number, count: number) => {
  expect(extractColumn(plate(world), column)).toHaveLength(count)
})

Then('the parsed values match the workbook', (world: World) => {
  const data = plate(world)
  // Both ends of both rows: a transposed or reversed read reproduces one corner and no more.
  expect(wellValue(data, 'A', 1)).toBe(0.132)
  expect(wellValue(data, 'A', 11)).toBe(0.36)
  expect(wellValue(data, 'B', 1)).toBe(0.13)
  expect(wellValue(data, 'B', 11)).toBe(0.35)
  expect(extractRow(data, 'A').slice(0, 9)).toEqual([...REFERENCE_ABSORBANCES])
})

Then('every well is empty', (world: World) => {
  const readable = plate(world)
    .values.flatMap((row, r) => row.map((value, c) => (value === null ? null : `${PLATE_ROWS[r]}${c + 1}`)))
    .filter((well): well is string => well !== null)
  expect(readable, 'wells still holding a reading').toEqual([])
})

Then('the plate holds no values', (world: World) => {
  expect(plate(world).values, 'the parsed grid').toEqual([])
})

Then('the rows that did parse are still shown', (world: World) => {
  // The grid is annotated, not blanked. The error is what stops the analysis; keeping the rows is
  // what lets the researcher see which one is short, which is the only way to fix it.
  const data = plate(world)
  expect(data.values, 'the rows the parser kept').toHaveLength(3)
  expect(wellValue(data, 'A', 1), 'the first well of the first full row').not.toBeNull()
})

Then('the plate reports no issues', (world: World) => {
  expectNoIssues(plate(world).issues)
})

Then('the plate is flagged {string} at {} severity', (world: World, code: string, level: string) => {
  expectIssue(plate(world).issues, code, level)
})

Then(
  'the plate is flagged {string} at {} severity naming {string}',
  (world: World, code: string, level: string, name: string) => {
    expectNames(expectIssue(plate(world).issues, code, level), name)
  },
)

Then(
  'the plate is flagged {string} at {} severity naming row {int}',
  (world: World, code: string, level: string, row: number) => {
    const found = expectIssue(plate(world).issues, code, level)
    expect(context(found).get('rows'), `the rows ${code} named`).toContain(String(row))
  },
)

// --- file import -----------------------------------------------------------

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

Given('a comma separated 8x12 grid as a file', (world: World) => {
  world.plateText = gridText(gridCells(), 'commas')
  world.bytes = bytesOf(world.plateText as string)
})

Given('a tab separated 8x12 grid as a file', (world: World) => {
  world.plateText = gridText(gridCells())
  world.bytes = bytesOf(world.plateText as string)
})

Given('a comma separated 8x12 grid as a file with a UTF-8 byte order mark', (world: World) => {
  world.plateText = gridText(gridCells(), 'commas')
  // Written as an escape rather than the character itself, which is invisible in a diff and is
  // exactly the sort of thing a reviewer cannot see has been deleted.
  world.bytes = bytesOf(`\u{FEFF}${world.plateText as string}`)
})

Given(
  'a comma separated 8x12 grid encoded as cp1252 whose well {string} reads {string}',
  (world: World, well: string, token: string) => {
    const cells = gridCells()
    const row = PLATE_ROWS.indexOf(well[0] as (typeof PLATE_ROWS)[number])
    ;(cells[row] as string[])[number(well.slice(1)) - 1] = token
    // Encoded a byte at a time rather than through TextEncoder, which only writes UTF-8. A degree
    // sign as the single byte 0xB0 is precisely what makes the file undecodable as UTF-8, and
    // therefore what the cp1252 fallback exists for.
    const text = gridText(cells, 'commas')
    world.bytes = Uint8Array.from([...text].map((ch) => (ch === '°' ? 0xb0 : ch.charCodeAt(0))))
  },
)

Given('a file whose first bytes are those of {}', (world: World, format: string) => {
  const signatures: Record<string, number[]> = {
    'an xlsx workbook': [0x50, 0x4b, 0x03, 0x04],
    'a legacy xls': [0xd0, 0xcf, 0x11, 0xe0],
    'a PDF': [0x25, 0x50, 0x44, 0x46],
    'a PNG image': [0x89, 0x50, 0x4e, 0x47],
    'a JPEG image': [0xff, 0xd8, 0xff],
  }
  const signature = signatures[format]
  if (signature === undefined) throw new Error(`"${format}" is not a format this fixture knows`)
  world.bytes = Uint8Array.from([...signature, ...Array.from({ length: 40 }, (_, i) => i)])
})

Given('a file of zero bytes', (world: World) => {
  world.bytes = new Uint8Array(0)
})

Given('a file of random bytes that decode to no readable number', (world: World) => {
  // Fixed bytes rather than actually random ones. "Random" in the scenario describes what the
  // file is to the researcher — a file that is not a plate — and a fixture that varied per run
  // would sometimes produce a token that parses and fail on those runs only.
  world.bytes = Uint8Array.from(Array.from({ length: 64 }, (_, i) => 0x80 + (i % 0x60)))
})

Given('a comma separated file whose rows hold 12, 11 and 12 cells', (world: World) => {
  world.bytes = bytesOf(gridText(raggedRows(), 'commas'))
})

Given('a file of null bytes, lone surrogates and very long lines', (world: World) => {
  const surrogate = [0xed, 0xa0, 0x80]
  world.bytes = Uint8Array.from([
    0x00,
    0x00,
    ...surrogate,
    ...Array.from({ length: 4096 }, () => 0x41),
    0x0a,
    ...surrogate,
  ])
})

When('the file is imported', (world: World) => {
  try {
    world.plate = parsePlateCsv(world.bytes as Uint8Array)
    world.threw = false
  } catch (error) {
    world.threw = error
  }
})

Then('the values match parsing the same text as a paste', (world: World) => {
  expect(plate(world).values).toEqual(parsePlate(world.plateText as string).values)
})

Then('the message shows the degree sign rather than mojibake', (world: World) => {
  const found = plate(world).issues.find((i) => i.message.includes('°'))
  expect(found, 'no issue quoted the cell back with its degree sign').toBeDefined()
  expect((found as Issue).message, 'the quoted cell').not.toContain('Â')
})

Then('the import is flagged {string} at {} severity', (world: World, code: string, level: string) => {
  expectIssue(plate(world).issues, code, level)
})

/**
 * Anchored, and registered separately from the `naming {string}` form below, because a Cucumber
 * `{string}` placeholder would otherwise let one expression match both sentences.
 */
Then(/^the import is flagged at error severity$/, (world: World) => {
  expect(
    plate(world).issues.filter((i) => i.severity === 'error').map((i) => i.code),
    'errors from the import',
  ).not.toEqual([])
})

Then(
  'the import is flagged at error severity naming {string}',
  (world: World, named: string) => {
    const found = plate(world).issues.find((i) => i.severity === 'error')
    expect(found, 'the import raised no error at all').toBeDefined()
    expectNames(found as Issue, named)
  },
)

Then('the advice says to export the plate as CSV', (world: World) => {
  const advised = plate(world).issues.filter((i) => i.message.includes('CSV'))
  expect(advised.map((i) => i.code), 'an issue telling the user what to do instead').not.toEqual([])
})

Then('no exception escapes the importer', (world: World) => {
  expect(world.threw, 'the importer threw').toBe(false)
})

Given('the plate loading panel', (world: World) => {
  world.panel = 'plate'
})

When('its routes are listed', (world: World) => {
  world.routes = PLATE_LOAD_ROUTES.map((route) => route.label)
})

Then('the routes read {string}, {string}, {string} in that order', (
  world: World,
  first: string,
  second: string,
  third: string,
) => {
  expect(world.routes, 'the load routes, left to right').toEqual([first, second, third])
})

Then('{string} is the route that opens', (_world: World, label: string) => {
  expect(PLATE_LOAD_ROUTE_THAT_OPENS, 'the route the panel opens on').toBe(label)
})

// --- regions ---------------------------------------------------------------

Given('the region {string}', (world: World, region: string) => {
  world.region = region
})

Given('regions of random punctuation, huge column numbers and unicode', (world: World) => {
  // Fixed for the same reason as the hostile file above, and chosen so each one fails for a
  // different reason: nothing to parse, a span longer than any plate, a row that is not a letter,
  // a rectangle, and a list of separators with no wells between them.
  world.regions = ['!!!', 'A1:A99999', 'Ω1', '💥', 'A1:B9', '::::', ',,,,']
})

When('the region is resolved', (world: World) => {
  try {
    const parsed = parseRegion(world.region as string, 'region')
    world.wells = parsed.wells
    world.regionIssues = parsed.issues
    world.threw = false
  } catch (error) {
    world.threw = error
  }
})

When('each region is resolved', (world: World) => {
  try {
    world.resolved = (world.regions as string[]).map((region) => ({
      region,
      ...parseRegion(region, 'region'),
    }))
    world.threw = false
  } catch (error) {
    world.threw = error
  }
})

Then('the wells are {string}', (world: World, expected: string) => {
  expect((world.wells as string[]).join(',')).toBe(expected.split(',').map((w) => w.trim()).join(','))
})

Then('no wells are produced', (world: World) => {
  expect(world.wells, 'wells from a region that was refused').toEqual([])
})

Then('the region reports no issues', (world: World) => {
  expectNoIssues(world.regionIssues as Issue[])
})

Then('the region is flagged {string} at {} severity', (world: World, code: string, level: string) => {
  expectIssue(world.regionIssues as Issue[], code, level)
})

Then('every region reports an issue at error severity', (world: World) => {
  const quiet = (world.resolved as Array<{ region: string; issues: Issue[] }>)
    .filter((r) => !r.issues.some((i) => i.severity === 'error'))
    .map((r) => r.region)
  expect(quiet, 'regions that were accepted without complaint').toEqual([])
})

Then('no exception escapes the mapper', (world: World) => {
  expect(world.threw, 'the mapper threw').toBe(false)
})

// --- mapping wells to standards and samples --------------------------------

function referenceRow(): number[] {
  return [...REFERENCE_ABSORBANCES]
}

Given('a plate whose row A holds the nine reference absorbances', (world: World) => {
  withRows(world, { A: referenceRow() })
})

Given('a plate whose rows A and B both hold the nine reference absorbances', (world: World) => {
  withRows(world, { A: referenceRow(), B: referenceRow() })
})

Given('a plate whose row C holds three absorbances', (world: World) => {
  withRows(world, { C: THREE_REPLICATES })
})

Given(
  'a plate whose row C holds three absorbances and well {string} read {string}',
  (world: World, well: string, token: string) => {
    // The sentinel goes in through the parser rather than as a null, because "unreadable" and
    // "never plated" are different facts about a well and only the parser can tell them apart.
    const row = ['0.43', token, '0.43', ...Array<string>(N_COLS - 3).fill('-')]
    const cells = PLATE_ROWS.map((label) =>
      label === well[0] ? row : Array<string>(N_COLS).fill('-'),
    )
    world.plate = parsePlate(gridText(cells))
  },
)

Given('a plate of {int} rows by {int} columns', (world: World, rows: number, columns: number) => {
  world.plate = parsePlate(
    gridText(
      Array.from({ length: rows }, (_, r) =>
        Array.from({ length: columns }, (_, c) => ((5 + r * columns + c) / 100).toFixed(2)),
      ),
    ),
  )
})

function mapped(world: World): { levels: unknown[]; issues: Issue[] } {
  const result = world.mapping as { levels: unknown[]; issues: Issue[] } | undefined
  if (result === undefined) throw new Error('nothing has been mapped; check the When step')
  return result
}

function mapStandardsFrom(world: World, regions: string[], concentrations: readonly number[]): void {
  // The option is omitted rather than passed as undefined: `exactOptionalPropertyTypes` treats
  // "absent" and "present but undefined" as different, and only one of them is the default.
  const tubeIds = world.tubeIds as string[] | undefined
  const result = mapStandards(
    plate(world),
    regions,
    concentrations,
    tubeIds === undefined ? {} : { tubeIds },
  )
  world.mapping = result
  world.levels = result.levels
}

When('the standards are mapped from {string} and fitted', (world: World, region: string) => {
  mapStandardsFrom(world, [region], REFERENCE_CONCENTRATIONS)
  // Fitted the way the workbook fits, so the comparison is against the curve this app already
  // claims reproduces the sheet rather than against a second fit of its own.
  world.mappedFit = fitCurve(world.levels as never, { blankSubtract: false })
})

When('the standards are mapped from {string} and {string}', (world: World, a: string, b: string) => {
  mapStandardsFrom(world, [a, b], REFERENCE_CONCENTRATIONS)
})

When('the standards are mapped from {string} with tube identifiers', (world: World, region: string) => {
  world.tubeIds = [...REFERENCE_TUBE_IDS]
  mapStandardsFrom(world, [region], REFERENCE_CONCENTRATIONS)
})

When(
  'the standards are mapped from {string} against nine concentrations',
  (world: World, region: string) => {
    mapStandardsFrom(world, [region], REFERENCE_CONCENTRATIONS)
  },
)

When(
  'the standards are mapped from {string} against twelve concentrations',
  (world: World, region: string) => {
    mapStandardsFrom(world, [region], [...REFERENCE_CONCENTRATIONS, 2500, 3000, 3500])
  },
)

When('the sample {string} is mapped from {string}', (world: World, name: string, region: string) => {
  const result = mapSamples(plate(world), [[name, region]])
  world.mapping = { levels: [], issues: result.issues }
  world.mappedSamples = result.samples
})

When(
  'the standards take {string} and the sample {string} takes {string}',
  (world: World, standards: string, name: string, sample: string) => {
    world.mapping = { levels: [], issues: checkOverlap([standards], [[name, sample]]) }
  },
)

Then('the coefficients equal those of the curve fitted from the values directly', (world: World) => {
  const fromPlate = world.mappedFit as { coefficients: readonly number[] }
  expect([...fromPlate.coefficients]).toEqual([...referenceFit().coefficients])
})

Then('each standard level carries {int} replicates', (world: World, count: number) => {
  const levels = world.levels as Array<{ replicates: readonly unknown[] }>
  expect(levels.map((l) => l.replicates.length), 'replicates per level').toEqual(
    levels.map(() => count),
  )
})

Then('each standard level carries its tube label', (world: World) => {
  const levels = world.levels as Array<{ tubeId: string | null }>
  expect(levels.map((l) => l.tubeId)).toEqual([...REFERENCE_TUBE_IDS])
})

Then(
  'one sample named {string} is produced with {int} replicates',
  (world: World, name: string, count: number) => {
    const samples = world.mappedSamples as Array<{ name: string; replicates: readonly unknown[] }>
    expect(samples.map((s) => s.name)).toEqual([name])
    expect((samples[0] as { replicates: readonly unknown[] }).replicates).toHaveLength(count)
  },
)

Then(
  'the sample {string} carries {int} replicates of which one is empty',
  (world: World, name: string, count: number) => {
    const found = (world.mappedSamples as Array<{ name: string; replicates: (number | null)[] }>)
      .find((s) => s.name === name)
    expect(found, `no sample named ${name} was mapped`).toBeDefined()
    const replicates = (found as { replicates: (number | null)[] }).replicates
    expect(replicates).toHaveLength(count)
    expect(replicates.filter((r) => r === null), 'the unreadable well, kept as a hole').toHaveLength(1)
  },
)

Then('no standard levels are produced', (world: World) => {
  expect(mapped(world).levels, 'levels from a refused mapping').toEqual([])
})

Then('the mapping is flagged {string} at {} severity', (world: World, code: string, level: string) => {
  expectIssue(mapped(world).issues, code, level)
})

Then(
  'the mapping is flagged {string} at {} severity naming {string}',
  (world: World, code: string, level: string, name: string) => {
    expectNames(expectIssue(mapped(world).issues, code, level), name)
  },
)

Then('both claimants are named in the issue', (world: World) => {
  const found = mapped(world).issues.find((i) => i.code === 'OVERLAPPING_REGIONS') as Issue
  expect(context(found).get('claimants'), 'how many claimed the well').toBe('2')
  expect(found.message, 'the issue text').toContain('standards')
  expect(found.message, 'the issue text').toContain('MCF7')
})

// --- the default layout ----------------------------------------------------

Given('a plate with the standard series in rows A and B', (world: World) => {
  withRows(world, { A: referenceRow(), B: referenceRow() })
})

Given('a plate with the standard series in row A and row B empty', (world: World) => {
  withRows(world, { A: referenceRow(), B: [] })
})

Given('a plate with the standard series in row A', (world: World) => {
  withRows(world, { A: referenceRow() })
})

Given('a plate with the standard series in row A and row C empty', (world: World) => {
  withRows(world, { A: referenceRow(), C: [] })
})

Given('a plate whose wells are all empty', (world: World) => {
  withRows(world, {})
})

Given('rows C and D each holding three replicates', (world: World) => {
  withRows(world, { C: THREE_REPLICATES, D: [0.36, 0.36, 0.36] })
})

Given('row C holding two readings and row D holding five', (world: World) => {
  withRows(world, { C: [0.43, 0.44], D: [0.36, 0.35, 0.36, 0.37, 0.36] })
})

Given('row C holding three readings, a gap, then a stray reading in C7', (world: World) => {
  withRows(world, { C: [0.43, 0.43, 0.43, null, null, null, 0.9] })
})

Given('row D holding three replicates', (world: World) => {
  withRows(world, { D: [0.36, 0.36, 0.36] })
})

Given('rows C through H each holding three replicates', (world: World) => {
  const rows: Record<string, number[]> = {}
  for (const row of PLATE_ROWS.slice(2)) rows[row] = [...THREE_REPLICATES]
  withRows(world, rows)
})

function deriveLayout(world: World, names: string[]): void {
  world.names = names
  world.layout = defaultLayout(plate(world), names)
}

When('the layout is derived for the names {string} and {string}', (world: World, a: string, b: string) => {
  deriveLayout(world, [a, b])
})

When('the layout is derived for the name {string}', (world: World, name: string) => {
  deriveLayout(world, [name])
})

When('the layout is derived for seven sample names', (world: World) => {
  deriveLayout(world, ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'])
})

interface Layout {
  standardRegions: readonly string[]
  assignments: ReadonlyArray<readonly [string, string]>
  issues: readonly Issue[]
}

function layout(world: World): Layout {
  const derived = world.layout as Layout | undefined
  if (derived === undefined) throw new Error('no layout has been derived; check the When step')
  return derived
}

/** "MCF7=C1:C3" — the way the features write one assignment. */
function assignmentText(assignments: ReadonlyArray<readonly [string, string]>): string[] {
  return assignments.map(([name, region]) => `${name}=${region}`)
}

Then('the standard regions are {string} and {string}', (world: World, a: string, b: string) => {
  expect(layout(world).standardRegions).toEqual([a, b])
})

Then('the standard regions are {string} alone', (world: World, only: string) => {
  expect(layout(world).standardRegions).toEqual([only])
})

Then('no standard regions are produced', (world: World) => {
  expect(layout(world).standardRegions, 'regions derived from a plate with nothing on it').toEqual([])
})

Then('the sample assignments are {string} and {string}', (world: World, a: string, b: string) => {
  expect(assignmentText(layout(world).assignments)).toEqual([a, b])
})

Then('the sample assignments are {string} alone', (world: World, only: string) => {
  expect(assignmentText(layout(world).assignments)).toEqual([only])
})

Then('no sample assignments are produced', (world: World) => {
  expect(assignmentText(layout(world).assignments), 'assignments on an empty plate').toEqual([])
})

Then('the first six samples are still assigned', (world: World) => {
  // The names that fit are mapped and the one that does not is reported. Refusing all seven would
  // make a plate that is one row short unusable rather than six-sevenths usable.
  expect(assignmentText(layout(world).assignments)).toHaveLength(6)
})

Then('the layout reports no issues', (world: World) => {
  expectNoIssues(layout(world).issues)
})

Then(
  'the layout is flagged {string} at {} severity naming {string}',
  (world: World, code: string, level: string, name: string) => {
    expectNames(expectIssue(layout(world).issues, code, level), name)
  },
)

Then(
  'the layout is flagged {string} at {} severity naming the {int}th name',
  (world: World, code: string, level: string, position: number) => {
    const found = expectIssue(layout(world).issues, code, level)
    expect(context(found).get('row'), `the position ${code} named`).toBe(String(position))
    expectNames(found, (world.names as string[])[position - 1] as string)
  },
)

// --- selection, round trip and clearing ------------------------------------

Given('the wells {string} have been selected', (world: World, clicked: string) => {
  world.selection = clicked.split(',').map((well) => well.trim())
})

Given('two samples whose wells have been selected', (world: World) => {
  // Stored as a session, which is where a layout actually lives. That is the whole of the
  // clearing scenario: the names and their wells are held in a structure that has nowhere to
  // put an absorbance, so nothing that clears the readings can reach them.
  world.session = StoredSessionSchema.parse({
    version: 1,
    sampleAssignments: [
      { name: 'MCF7', region: wellsToRegion(['C1', 'C2', 'C3']) },
      { name: 'RPMI8226', region: wellsToRegion(['D1', 'D2', 'D3']) },
    ],
  })
})

When('the region is built from the selection', (world: World) => {
  const region = wellsToRegion(world.selection as string[])
  world.region = region
  const parsed = parseRegion(region, 'region')
  world.wells = parsed.wells
  world.regionIssues = parsed.issues
})

When('the plate is cleared', (world: World) => {
  world.plate = EMPTY_PLATE
  world.plateText = ''
})

Then('the region reads {string}', (world: World, expected: string) => {
  expect(world.region).toBe(expected)
})

Then('parsing that region returns the wells {string}', (world: World, expected: string) => {
  expect((world.wells as string[]).join(',')).toBe(expected.split(',').map((w) => w.trim()).join(','))
})

Then('the pasted text is empty', (world: World) => {
  expect(world.plateText, 'the paste box').toBe('')
})

Then('both sample names and their wells survive', (world: World) => {
  const session = world.session as { sampleAssignments: Array<{ name: string; region: string }> }
  expect(session.sampleAssignments.map((a) => `${a.name}=${a.region}`)).toEqual([
    'MCF7=C1:C3',
    'RPMI8226=D1:D3',
  ])
})

// `numberList` is imported for the concentration lists the mapping scenarios name in prose; it is
// referenced here so a future scenario that spells its own concentrations has the parser to hand.
void numberList
