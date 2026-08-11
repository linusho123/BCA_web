import { Given, Then, When } from 'quickpickle'
import { expect } from 'vitest'
import { fitCurve } from '~/domain/curve'
import type { Issue } from '~/domain/errors'
import {
  type LoadingRow,
  type SampleInput,
  type SampleResult,
  analyseSamples,
  buildLoadingPlan,
} from '~/domain/samples'
import { referenceFit, referenceLevels } from '~/domain/reference'
import {
  type World,
  expectAt,
  expectIssue,
  number,
  replicateList,
  slot,
} from '../support/world'

/**
 * Proves features/samples/sample-back-calculation.feature and
 * features/samples/loading-plan.feature.
 *
 * The two features meet at `SampleResult`: back-calculation produces it and the loading plan
 * consumes it. A loading scenario that names a concentration directly builds a synthetic result
 * rather than running an assay to reach it, so a loading failure never has to be traced back
 * through the curve to find out whether the fit or the plan was at fault.
 */

const results = (world: World): SampleResult[] => slot<SampleResult[]>(world, 'results')
const rows = (world: World): LoadingRow[] => slot<LoadingRow[]>(world, 'rows')

/** The result carrying a given name, failing by name when the scenario misspells one. */
function named(list: readonly { name: string }[], name: string): SampleResult | LoadingRow {
  const found = list.find((r) => r.name === name)
  if (!found) {
    throw new Error(`no "${name}" among: ${list.map((r) => r.name).join(', ') || 'nothing'}`)
  }
  return found as SampleResult | LoadingRow
}

const result = (world: World, name: string): SampleResult =>
  named(results(world), name) as SampleResult

const row = (world: World, name: string): LoadingRow => named(rows(world), name) as LoadingRow

/** Append a sample to whatever the scenario has already set up. */
function addSample(world: World, sample: SampleInput): void {
  world.samples = [...((world.samples as SampleInput[] | undefined) ?? []), sample]
}

/**
 * A `SampleResult` at a stated stock concentration, with nothing else filled in.
 *
 * The loading feature states concentrations directly — "the sample MCF7 at 0.532... ug/uL" —
 * because that is the only field the plan reads. Everything else is absent rather than
 * plausible-looking, so a plan that reached for a replicate or an absorbance would fail here
 * instead of quietly working off a number the researcher never supplied.
 */
function syntheticResult(name: string, concUgPerUL: number | null, issues: Issue[] = []): SampleResult {
  return {
    name,
    replicates: [],
    n: 0,
    meanAbs: null,
    sdAbs: null,
    cvPercent: null,
    concUgPerML: concUgPerUL === null ? null : concUgPerUL * 1000,
    concUgPerUL,
    dilutionFactor: 1,
    extrapolated: false,
    issues,
  }
}

/** The four names the two features share, in an order no sort would produce. */
const DELIBERATE_ORDER = ['Zeta', 'alpha', 'M2', 'Beta']

// --- Given: the curve -----------------------------------------------------

Given('the reference curve fitted without blank subtraction', (world: World) => {
  world.fit = referenceFit()
})

Given('the reference curve fitted with blank subtraction', (world: World) => {
  world.fit = fitCurve(referenceLevels(), { blankSubtract: true })
})

// --- Given: the samples ---------------------------------------------------

Given(
  'the sample {string} read at {} with a dilution factor of {}',
  (world: World, name: string, absorbance: string, factor: string) => {
    addSample(world, { name, replicates: [number(absorbance)] })
    world.dilutionFactor = number(factor)
  },
)

Given(
  /^the sample "([^"]+)" read at ([\d., and]+)$/,
  (world: World, name: string, values: string) => {
    // "0.42, 0.43 and 0.44" is how the feature writes a set of replicates in prose; the parser
    // takes a comma-separated list, so the trailing "and" is dropped rather than parsed.
    addSample(world, { name, replicates: replicateList(values.replace(/\s+and\s+/g, ', ')) })
  },
)

Given('the sample {string} with every replicate empty', (world: World, name: string) => {
  addSample(world, { name, replicates: [null, null, null] })
})

Given('a sample whose fitted concentration is negative', (world: World) => {
  // A real property of the workbook's own curve rather than a contrived input: its intercept is
  // -71.9, so it crosses zero at about 0.115 absorbance — above the blank standard's own 0.132
  // reading is where it turns positive, and 0.05 is well below the crossing.
  world.negativeSample = 'Negative'
  addSample(world, { name: 'Negative', replicates: [0.05] })
})

Given('four samples named in a deliberate order', (world: World) => {
  // Neither alphabetical nor sorted by absorbance, so a step that reordered the table would be
  // caught rather than agreeing with the input by luck.
  for (const [i, name] of DELIBERATE_ORDER.entries()) {
    addSample(world, { name, replicates: [0.4 + 0.01 * i] })
  }
  world.expectedOrder = DELIBERATE_ORDER
})

// --- Given: the loading plan's inputs -------------------------------------

Given('the sample {string} at {} ug\\/uL', (world: World, name: string, conc: string) => {
  world.results = [...((world.results as SampleResult[] | undefined) ?? []),
    syntheticResult(name, number(conc))]
})

Given('the sample {string} with no concentration', (world: World, name: string) => {
  // Carrying the issue that left it empty, which is what the last scenario of the loading
  // feature checks travels through to the loading table.
  const upstream = analyseSamples(referenceFit(), [{ name, replicates: [null, null] }])
  world.results = [...((world.results as SampleResult[] | undefined) ?? []), upstream[0] as SampleResult]
})

Given(
  'a target of {} ug in {} uL with dye',
  (world: World, mass: string, volume: string) => {
    world.loadingOptions = { desiredProteinUg: number(mass), finalVolumeUL: number(volume) }
  },
)

Given(
  'a target of {} ug in {} uL without dye',
  (world: World, mass: string, volume: string) => {
    world.loadingOptions = {
      desiredProteinUg: number(mass),
      finalVolumeUL: number(volume),
      includeDye: false,
    }
  },
)

Given(
  'a target of {} ug in {} uL with a dye fraction of {}',
  (world: World, mass: string, volume: string, fraction: string) => {
    world.loadingOptions = {
      desiredProteinUg: number(mass),
      finalVolumeUL: number(volume),
      dyeFraction: number(fraction),
    }
  },
)

// --- When -----------------------------------------------------------------

When('the samples are analysed', (world: World) => {
  const factor = world.dilutionFactor as number | undefined
  world.results = analyseSamples(
    slot(world, 'fit'),
    slot<SampleInput[]>(world, 'samples'),
    factor === undefined ? {} : { dilutionFactor: factor },
  )
})

When('the loading plan is built', (world: World) => {
  // The order-preservation scenario reaches here with samples rather than concentrations, so an
  // analysis is run first when that is what the scenario set up.
  if (world.results === undefined) {
    world.results = analyseSamples(referenceFit(), slot<SampleInput[]>(world, 'samples'))
  }
  world.rows = buildLoadingPlan(results(world), slot(world, 'loadingOptions'))
})

// --- Then: the concentrations --------------------------------------------

Then('{string} is {} ug\\/mL in the well', (world: World, name: string, expected: string) => {
  expectAt(result(world, name).concUgPerML, expected, `${name} in the well`)
})

Then('{string} is {} ug\\/uL in the stock', (world: World, name: string, expected: string) => {
  expectAt(result(world, name).concUgPerUL, expected, `${name} in the stock`)
})

Then('{string} has a mean absorbance of {}', (world: World, name: string, expected: string) => {
  expectAt(result(world, name).meanAbs, expected, `${name} mean absorbance`)
})

Then(
  '{string} carries a standard deviation and a coefficient of variation',
  (world: World, name: string) => {
    const found = result(world, name)
    expect(found.sdAbs, `${name} has no standard deviation`).not.toBeNull()
    expect(found.cvPercent, `${name} has no coefficient of variation`).not.toBeNull()
  },
)

Then('{string} is marked as extrapolated', (world: World, name: string) => {
  expect(result(world, name).extrapolated, `${name} was read as if the curve reached it`).toBe(true)
})

Then('the negative value is still reported', (world: World) => {
  // Kept rather than nulled: a researcher who can see -18 ug/mL knows the reading sits below the
  // blank, where an absent value would look like a sample that simply failed to read.
  const found = result(world, slot<string>(world, 'negativeSample'))
  expect(found.concUgPerML as number).toBeLessThan(0)
})

Then('{string} appears in the results', (world: World, name: string) => {
  expect(results(world).map((r) => r.name)).toContain(name)
})

Then('{string} has no mean absorbance and no concentration', (world: World, name: string) => {
  const found = result(world, name)
  expect(found.meanAbs, `${name} produced a mean from nothing`).toBeNull()
  expect(found.concUgPerML, `${name} produced a concentration from nothing`).toBeNull()
})

Then('{string} has no stock concentration', (world: World, name: string) => {
  expect(result(world, name).concUgPerUL).toBeNull()
})

Then('the results appear in that order with those names', (world: World) => {
  expect(results(world).map((r) => r.name)).toEqual(slot<string[]>(world, 'expectedOrder'))
})

Then('no exception escapes the analyser', (world: World) => {
  // Reaching this step at all is the assertion: a throw in the When would have failed the
  // scenario there. Asserting the shape as well keeps it from being a step that tests nothing.
  expect(Array.isArray(results(world))).toBe(true)
})

// --- Then: the loading rows ----------------------------------------------

/**
 * Written as a regex anchored at the end, because `{string} needs {} uL of sample` also matches
 * the three-volume sentence below — a Cucumber `{}` will happily swallow the rest of the line.
 */
Then(/^"([^"]+)" needs (\S+) uL of sample$/, (world: World, name: string, expected: string) => {
  expectAt(row(world, name).proteinUL, expected, `${name} protein volume`)
})

Then(
  '{string} needs {} uL of sample, {} uL of diluent and {} uL of dye',
  (world: World, name: string, protein: string, diluent: string, dye: string) => {
    const found = row(world, name)
    expectAt(found.proteinUL, protein, `${name} protein volume`)
    expectAt(found.diluentUL, diluent, `${name} diluent volume`)
    expectAt(found.dyeUL, dye, `${name} dye volume`)
  },
)

/** Anchored for the same reason as the protein-volume step above. */
Then(/^"([^"]+)" needs (\S+) uL of dye$/, (world: World, name: string, expected: string) => {
  expectAt(row(world, name).dyeUL, expected, `${name} dye volume`)
})

Then('those three volumes sum to {} uL', (world: World, expected: string) => {
  // The lane is what gets pipetted; parts that do not sum to the whole mean one of the three
  // numbers on screen is wrong, with no way to tell which from the bench.
  const found = rows(world)[0] as LoadingRow
  const total = (found.proteinUL as number) + (found.diluentUL as number) + found.dyeUL
  expect(total, 'the three volumes').toBeCloseTo(number(expected), 9)
})

Then('{string} is not feasible', (world: World, name: string) => {
  expect(row(world, name).feasible, `${name} was reported as a lane that fits`).toBe(false)
})

Then('{string} needs no stated volume of sample', (world: World, name: string) => {
  expect(row(world, name).proteinUL, `${name} stated a volume it cannot deliver`).toBeNull()
})

Then('{string} appears in the loading rows', (world: World, name: string) => {
  expect(rows(world).map((r) => r.name)).toContain(name)
})

Then(
  '{string} carries the issue that left it without a concentration',
  (world: World, name: string) => {
    // The loading table explains itself, so a researcher reading it never has to cross-reference
    // the samples table to find out why a lane is empty.
    expectIssue(row(world, name).issues, 'NO_DATA', 'info')
  },
)

Then('the loading rows appear in that order with those names', (world: World) => {
  expect(rows(world).map((r) => r.name)).toEqual(slot<string[]>(world, 'expectedOrder'))
})

Then('no negative diluent volume is reported', (world: World) => {
  // The workbook's defect, stated as a property of every row: -750.66 uL of diluent is not a
  // volume, and printing one is what this whole feature exists to prevent.
  const negative = rows(world)
    .filter((r) => r.diluentUL !== null && r.diluentUL < 0)
    .map((r) => `${r.name} at ${r.diluentUL} uL`)
  expect(negative, 'rows printing a diluent volume nobody can pipette').toEqual([])
})

Then(
  'the message states {} uL required against {} uL available',
  (world: World, required: string, available: string) => {
    const found = rows(world).flatMap((r) => r.issues).find((i) => i.code === 'INSUFFICIENT_VOLUME')
    expect(found, 'no INSUFFICIENT_VOLUME issue was raised').toBeDefined()
    // Read out of the issue's context rather than matched in its prose: the numbers are what the
    // researcher acts on, and an assertion on the sentence would break every time it is reworded.
    const context = new Map((found as Issue).context)
    expect(Number(context.get('requiredUL')), 'required volume').toBeCloseTo(number(required), 2)
    expect(Number(context.get('availableUL')), 'available volume').toBeCloseTo(
      number(available),
      2,
    )
  },
)

// `the plan reports no issues` is registered in dilution.steps.ts alongside the flag step, for
// the same reason.

// --- Then: the flags ------------------------------------------------------

Then(
  '{string} is flagged {string} at {} severity',
  (world: World, name: string, code: string, level: string) => {
    const issues =
      world.rows === undefined ? result(world, name).issues : row(world, name).issues
    expectIssue(issues, code, level, ` for ${name}`)
  },
)

Then(
  'that sample is flagged {string} at {} severity',
  (world: World, code: string, level: string) => {
    expectIssue(result(world, slot<string>(world, 'negativeSample')).issues, code, level)
  },
)

// `the plan is flagged {string} at {} severity` is registered in dilution.steps.ts. Both features
// use the sentence and the registry is global, so that one registration reads whichever plan the
// scenario built — see `planIssues` there.
