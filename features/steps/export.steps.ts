import { Given, Then, When } from 'quickpickle'
import { expect } from 'vitest'
import { FitModel } from '~/domain/constants'
import { type CurveFit, fitCurve } from '~/domain/curve'
import { type DilutionPlan, planDilutions } from '~/domain/dilution'
import {
  type SessionSnapshot,
  curveToCsv,
  dilutionPlanToCsv,
  provenanceHeader,
  samplesToCsv,
  sessionToJson,
} from '~/domain/export'
import { type SampleResult, analyseSamples } from '~/domain/samples'
import {
  REFERENCE_DILUTION_INPUT,
  REFERENCE_SAMPLES,
  referenceFit,
  referenceLevels,
  referencePlateText,
} from '~/domain/reference'
import { type World, expectAt, slot } from '../support/world'

/**
 * Proves features/export/result-export.feature.
 *
 * The exports are read back through a CSV reader written here rather than compared against
 * expected text. What the feature promises is that the file re-parses — that a row count is a row
 * count and a name survives the quoting — and asserting on the exact string would instead pin the
 * writer's formatting, which is not what anyone downstream depends on.
 *
 * Each Given records which table the scenario is talking about, because the feature says "it is
 * exported as CSV" about three different tables and the sentence has to be registered once.
 */

type Subject = 'dilution' | 'curve' | 'samples'

/** A record from a CSV, split on the delimiters that were outside quotes. */
type Record_ = string[]

/**
 * Read a CSV the way a spreadsheet would.
 *
 * Written out rather than pulled from a library because the round-trip scenarios turn on the
 * quoting rules specifically — a comma, a doubled quote, an embedded newline — and a reader
 * sharing code with the writer would agree with it whatever either of them did.
 */
function csvRecords(csv: string): Record_[] {
  const records: Record_[] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i] as string
    if (quoted) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      records.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    records.push(row)
  }
  return records
}

const isComment = (record: Record_): boolean => (record[0] ?? '').startsWith('#')

const csv = (world: World): string => slot<string>(world, 'csv')

/** The provenance block: every comment line, before anything a spreadsheet would call a row. */
function provenance(world: World): string {
  return csvRecords(csv(world))
    .filter(isComment)
    .map((r) => r.join(','))
    .join('\n')
}

function headerRow(world: World): Record_ {
  const found = csvRecords(csv(world)).find((r) => !isComment(r))
  expect(found, 'the CSV carried no header row at all').toBeDefined()
  return found as Record_
}

function dataRows(world: World): Record_[] {
  return csvRecords(csv(world)).filter((r) => !isComment(r)).slice(1)
}

/** One data row as a column-name-to-value map, which is how every assertion here reads it. */
function rowByName(world: World, name: string): globalThis.Record<string, string> {
  const header = headerRow(world)
  const found = dataRows(world).find((r) => r[0] === name)
  const present = dataRows(world).map((r) => r[0]).join(', ') || 'nothing'
  expect(found, `no row named "${name}"; the CSV holds: ${present}`).toBeDefined()
  return Object.fromEntries(header.map((column, i) => [column, (found as Record_)[i] ?? '']))
}

/** Analyse against the workbook's own curve, which is what every export scenario is fitted to. */
function analyse(
  world: World,
  samples: ReadonlyArray<{ name: string; replicates: (number | null)[] }>,
): SampleResult[] {
  const fit = (world.fit as CurveFit | undefined) ?? referenceFit()
  world.fit = fit
  // The factor is carried through when a step set one, so the exported stock concentration is the
  // one the scenario described rather than a well concentration relabelled.
  const factor = world.dilutionFactor as number | undefined
  return analyseSamples(fit, samples, factor === undefined ? {} : { dilutionFactor: factor })
}

/**
 * The analysed samples, running the analysis if the scenario only staged the inputs.
 *
 * "The analysed samples MCF7 and RPMI8226" is the plot feature's sentence and belongs to its step
 * module, which stages inputs and analyses them in its own When. This feature's When is an
 * export, so the analysis has to happen here — but only when nobody has done it, or a scenario
 * that built results deliberately would have them replaced.
 */
function results(world: World): SampleResult[] {
  const analysed = world.results as SampleResult[] | undefined
  if (analysed !== undefined) return analysed
  const staged = slot<Array<{ name: string; replicates: (number | null)[] }>>(world, 'samples')
  const next = analyse(world, staged)
  world.results = next
  return next
}

// --- Given: which table -----------------------------------------------------

Given('the reference dilution plan', (world: World) => {
  world.exportSubject = 'dilution' satisfies Subject
  world.plan = planDilutions(REFERENCE_DILUTION_INPUT)
})

Given(
  'the reference curve fitted with blank subtraction using the quadratic model',
  (world: World) => {
    world.exportSubject = 'curve' satisfies Subject
    world.fit = fitCurve(referenceLevels(), {
      blankSubtract: true,
      model: FitModel.INVERSE_QUADRATIC,
    })
  },
)

Given('analysed samples carrying issues', (world: World) => {
  world.exportSubject = 'samples' satisfies Subject
  // Two different complaints rather than two of one, because the column is a list and a list of
  // one is not evidence that it joins. "Spread" fails on replicate agreement; "Concentrated"
  // reads above every standard, which is a warning about the curve rather than about the well.
  world.results = analyse(world, [
    { name: 'Spread', replicates: [0.2, 0.6] },
    { name: 'Concentrated', replicates: [2.4] },
  ])
})

Given('a sample with no concentration', (world: World) => {
  world.exportSubject = 'samples' satisfies Subject
  world.results = analyse(world, [{ name: 'Ghost', replicates: [null, null] }])
})

Given('no analysed samples', (world: World) => {
  world.exportSubject = 'samples' satisfies Subject
  world.results = []
})

/**
 * A sample whose name carries CSV punctuation.
 *
 * An anchored regex over `[\s\S]` rather than a `{}` placeholder, because one of the Examples
 * rows writes `\n` and Gherkin substitutes a real newline for it. A `{}` placeholder stops at the
 * end of a line, so it would match the first half of the name and leave the scenario testing a
 * name that has no newline in it — which is the one thing this scenario exists to check.
 */
Given(/^a sample named ([\s\S]+)$/, (world: World, name: string) => {
  world.exportSubject = 'samples' satisfies Subject
  world.sampleName = name
  world.results = analyse(world, [{ name, replicates: [0.43] }])
})

Given('a complete session with a plate, a curve and samples', (world: World) => {
  const fit = referenceFit()
  const analysed = analyseSamples(
    fit,
    REFERENCE_SAMPLES.map((s) => ({ name: s.name, replicates: [s.absorbance] })),
    { dilutionFactor: 2 },
  )
  world.session = {
    plateText: referencePlateText(),
    fit,
    samples: analysed,
    dilution: planDilutions(REFERENCE_DILUTION_INPUT),
    dilutionFactor: 2,
  } satisfies SessionSnapshot
})

Given('a sample whose concentration is Infinity', (world: World) => {
  // Built as a literal rather than reached through the curve. No absorbance produces an infinite
  // concentration from a cubic, so the only honest way to stage the value JSON cannot represent
  // is to put one there — the guard exists for a fit nobody has written yet, not for this one.
  world.infiniteSample = {
    name: 'Overflow',
    replicates: [0.43],
    n: 1,
    meanAbs: 0.43,
    sdAbs: null,
    cvPercent: null,
    concUgPerML: Infinity,
    concUgPerUL: Infinity,
    dilutionFactor: 1,
    extrapolated: false,
    issues: [],
  } satisfies SampleResult
  world.session = { samples: [world.infiniteSample as SampleResult] } satisfies SessionSnapshot
})

// --- When -------------------------------------------------------------------

/**
 * Which of the four tables "it is exported as CSV" means.
 *
 * Recorded by the Given where the feature's own Given says which table it is talking about, and
 * inferred otherwise — one scenario reaches here through a sentence the plot feature owns, which
 * stages samples and knows nothing about exports.
 */
function subject(world: World): Subject {
  const declared = world.exportSubject as Subject | undefined
  if (declared !== undefined) return declared
  if (world.samples !== undefined || world.results !== undefined) return 'samples'
  return 'curve'
}

function exportCsv(world: World): void {
  const which = subject(world)
  if (which === 'dilution') {
    world.csv = dilutionPlanToCsv(slot<DilutionPlan>(world, 'plan'))
  } else if (which === 'samples') {
    const rows = results(world)
    world.csv = samplesToCsv(rows, { fit: world.fit as CurveFit, dilutionFactor: 1 })
  } else {
    world.csv = curveToCsv(slot<CurveFit>(world, 'fit'))
  }
}

When('it is exported as CSV', exportCsv)
When('they are exported as CSV', exportCsv)
When('it is exported as CSV and re-parsed', exportCsv)

When('the provenance block is built', (world: World) => {
  world.csv = provenanceHeader({ fit: slot<CurveFit>(world, 'fit') }).join('\n')
})

When('the session is serialised', (world: World) => {
  world.json = sessionToJson(slot<SessionSnapshot>(world, 'session'))
})

When('the session is serialised and parsed back', (world: World) => {
  world.json = sessionToJson(slot<SessionSnapshot>(world, 'session'))
  world.parsed = JSON.parse(world.json as string)
})

// --- Then: the shape of the file -------------------------------------------

Then('the CSV re-parses to {int} data row(s)', (world: World, expected: number) => {
  expect(dataRows(world).map((r) => r[0]), 'the data rows').toHaveLength(expected)
})

Then('the header row is still present', (world: World) => {
  // The empty-export scenario. A file with no header is one a spreadsheet opens as a single blank
  // cell, which reads as "the export is broken" rather than "there was nothing to export".
  expect(headerRow(world)[0], 'the first column of the header').toBe('sample')
})

Then(
  'the columns include {string}, {string} and {string}',
  (world: World, a: string, b: string, c: string) => {
    const header = headerRow(world)
    for (const column of [a, b, c]) {
      expect(header, `the header row, looking for "${column}"`).toContain(column)
    }
  },
)

// --- Then: the provenance block --------------------------------------------

Then(
  'the provenance block records the coefficients {string}, {string}, {string} and {string}',
  (world: World, a: string, b: string, c: string, d: string) => {
    const block = provenance(world)
    for (const name of [a, b, c, d]) {
      expect(block, `the provenance block, looking for coefficient ${name}`).toContain(`${name}=`)
    }
  },
)

Then('the provenance block records the R squared', (world: World) => {
  expect(provenance(world), 'the provenance block').toContain('r_squared:')
})

Then('it names the model {string}', (world: World, model: string) => {
  expect(csv(world), 'the provenance block').toContain(model)
})

Then('it records that blank subtraction was on', (world: World) => {
  expect(csv(world), 'the provenance block').toContain('blank subtracted: yes')
})

Then('the provenance block records that the fit failed', (world: World) => {
  expect(provenance(world), 'the provenance block').toContain('curve did not fit')
})

Then('the provenance block lists the issues that caused it', (world: World) => {
  const block = provenance(world)
  const codes = slot<CurveFit>(world, 'fit').issues.map((i) => i.code)
  expect(codes, 'the fit gave no reason for failing, so there is nothing to export').not.toEqual([])
  for (const code of codes) {
    expect(block, `the provenance block, looking for ${code}`).toContain(code)
  }
})

// --- Then: the values in the rows ------------------------------------------

Then('the concentration of {string} reads {}', (world: World, name: string, expected: string) => {
  const field = rowByName(world, name)['conc_ug_per_mL'] as string
  expectAt(Number(field), expected, `the concentration of ${name}`)
  // And at full width. A four-decimal rounding would still satisfy the comparison above, and this
  // is the one column a researcher pastes straight into a figure.
  expect(
    (field.split('.')[1] ?? '').length,
    `${name}'s concentration was written as "${field}", which is rounded`,
  ).toBeGreaterThan(6)
})

Then("each row's issues column lists that row's codes", (world: World) => {
  for (const result of results(world)) {
    expect(result.issues, `${result.name} carried no issues to export`).not.toEqual([])
    expect(rowByName(world, result.name)['issues'], `${result.name}'s issues column`).toBe(
      result.issues.map((i) => i.code).join('; '),
    )
  }
})

Then('its concentration field is empty', (world: World) => {
  const row = rowByName(world, 'Ghost')
  expect(row['conc_ug_per_mL'], "Ghost's concentration").toBe('')
  expect(row['conc_ug_per_uL'], "Ghost's stock concentration").toBe('')
})

Then('the field is not the text {string}', (world: World, forbidden: string) => {
  // Checked across the whole file rather than the one cell: "None" reaching any numeric column is
  // the same bug, and it is a bug that arrives through a shared formatter.
  expect(csv(world), `the export, which must not contain "${forbidden}"`).not.toContain(forbidden)
})

Then('the name comes back exactly as written', (world: World) => {
  const name = slot<string>(world, 'sampleName')
  expect(dataRows(world)[0]?.[0], 'the name that came back').toBe(name)
})

// --- Then: the JSON session -------------------------------------------------

Then('the parsed session holds the same values', (world: World) => {
  const original = slot<SessionSnapshot>(world, 'session')
  const parsed = slot<globalThis.Record<string, unknown>>(world, 'parsed')

  expect(parsed['plateText'], 'the plate text').toBe(original.plateText)
  expect(parsed['dilutionFactor'], 'the dilution factor').toBe(original.dilutionFactor)
  expect(
    (parsed['fit'] as { coefficients: number[] }).coefficients,
    'the fitted coefficients',
  ).toEqual([...(original.fit as CurveFit).coefficients])
  expect(
    (parsed['samples'] as SampleResult[]).map((s) => [s.name, s.concUgPerML]),
    'the analysed samples',
  ).toEqual((original.samples ?? []).map((s) => [s.name, s.concUgPerML]))
  expect(
    (parsed['dilution'] as DilutionPlan).vials.map((v) => v.vialId),
    'the dilution vials',
  ).toEqual((original.dilution as DilutionPlan).vials.map((v) => v.vialId))
})

Then('that value is written as null', (world: World) => {
  const parsed = JSON.parse(slot<string>(world, 'json')) as { samples: SampleResult[] }
  expect(parsed.samples[0]?.concUgPerML, 'the concentration that was Infinity').toBeNull()
  // And not as the token `Infinity`, which is what `JSON.stringify` would emit for a value it
  // reached through a replacer and what no JSON parser will read back.
  expect(slot<string>(world, 'json'), 'the serialised session').not.toContain('Infinity')
})

Then('the session parses back without error', (world: World) => {
  const json = slot<string>(world, 'json')
  expect(
    () => {
      JSON.parse(json)
    },
    'parsing the session back',
  ).not.toThrow()
})
