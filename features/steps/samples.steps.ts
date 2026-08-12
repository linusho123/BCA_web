import { Given, Then, When } from 'quickpickle'
import { expect } from 'vitest'
import { fitCurve } from '~/domain/curve'
import { type SampleInput, type SampleResult, analyseSamples } from '~/domain/samples'
import { referenceFit, referenceLevels } from '~/domain/reference'
import {
  type World,
  expectAt,
  expectIssue,
  number,
  replicateList,
  slot,
} from '../support/world'

/** Proves features/samples/sample-back-calculation.feature. */

const results = (world: World): SampleResult[] => slot<SampleResult[]>(world, 'results')

/** The result carrying a given name, failing by name when the scenario misspells one. */
function result(world: World, name: string): SampleResult {
  const found = results(world).find((r) => r.name === name)
  if (!found) {
    const names = results(world).map((r) => r.name).join(', ')
    throw new Error(`no "${name}" among: ${names || 'nothing'}`)
  }
  return found
}

/** Append a sample to whatever the scenario has already set up. */
function addSample(world: World, sample: SampleInput): void {
  world.samples = [...((world.samples as SampleInput[] | undefined) ?? []), sample]
}

/** The four names the order scenario uses, in an order no sort would produce. */
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

// --- When -----------------------------------------------------------------

When('the samples are analysed', (world: World) => {
  const factor = world.dilutionFactor as number | undefined
  world.results = analyseSamples(
    slot(world, 'fit'),
    slot<SampleInput[]>(world, 'samples'),
    factor === undefined ? {} : { dilutionFactor: factor },
  )
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

// --- Then: the flags ------------------------------------------------------

Then(
  '{string} is flagged {string} at {} severity',
  (world: World, name: string, code: string, level: string) => {
    expectIssue(result(world, name).issues, code, level, ` for ${name}`)
  },
)

Then(
  'that sample is flagged {string} at {} severity',
  (world: World, code: string, level: string) => {
    expectIssue(result(world, slot<string>(world, 'negativeSample')).issues, code, level)
  },
)
