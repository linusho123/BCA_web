import { Given, Then, When } from 'quickpickle'
import { expect } from 'vitest'
import { FitModel } from '~/domain/constants'
import {
  type CurveFit,
  type StandardLevel,
  correct,
  fitCurve,
  predict,
  standardLevel,
} from '~/domain/curve'
import { CurveNotFittedError, type Issue, IssueCode } from '~/domain/errors'
import { isClose } from '~/domain/linalg'
import {
  REFERENCE_ABSORBANCES,
  REFERENCE_CONCENTRATIONS,
  REFERENCE_TUBE_IDS,
  referenceFit,
  referenceLevels,
} from '~/domain/reference'
import {
  type World,
  expectAt,
  expectIssue,
  expectNoErrors,
  expectNoIssue,
  number,
  producedCoefficients,
  slot,
} from '../support/world'

/**
 * Proves features/curve-fitting/standard-curve.feature and
 * features/curve-fitting/curve-quality-guards.feature.
 *
 * The Given steps only assemble levels; nothing is fitted until the When. That matters because
 * both features layer their setup — "the reference standards from the workbook" and then "one
 * level at -100 ug/mL" — and a Given that fitted eagerly would fit the wrong thing.
 */

const fit = (world: World): CurveFit => slot<CurveFit>(world, 'fit')

/**
 * The standards the scenario is working with.
 *
 * Assembled by the Givens in this module, except when the scenario reached here through a step
 * that fitted a curve outright — the plot feature's Background does that, and then layers one of
 * the level-shaping Givens on top. A fit carries the levels it was built from, so falling back to
 * them lets those Givens compose without the plot feature restating the workbook's standards.
 */
function levels(world: World): StandardLevel[] {
  const assembled = world.levels as StandardLevel[] | undefined
  if (assembled !== undefined) return assembled
  return [...slot<CurveFit>(world, 'fit').levels]
}

/** Replace the level series wholesale. */
function setLevels(world: World, next: StandardLevel[]): void {
  world.levels = next
}

/** Resolve a model spelled the way the features spell it: `inverse quadratic`. */
function model(label: string): FitModel {
  const key = label.trim().toLowerCase().replace(/[\s-]+/g, '_')
  const found = (
    {
      inverse_cubic: FitModel.INVERSE_CUBIC,
      inverse_quadratic: FitModel.INVERSE_QUADRATIC,
      inverse_linear: FitModel.INVERSE_LINEAR,
    } as Record<string, FitModel>
  )[key]
  if (!found) throw new Error(`"${label}" is not a model this app fits`)
  return found
}

/**
 * Fit whatever the Givens have assembled.
 *
 * Blank subtraction is passed only when a step named it. The features that say nothing about it
 * are asserting the behaviour a researcher gets by default, so the option has to be left off
 * rather than defaulted here, where a second copy of the default could drift from the domain's.
 */
function runFit(world: World, override?: FitModel): CurveFit {
  const blank = world.blankSubtract as boolean | undefined
  return fitCurve(levels(world), {
    model: override ?? ((world.model as FitModel | undefined) ?? FitModel.INVERSE_CUBIC),
    ...(blank === undefined ? {} : { blankSubtract: blank }),
  })
}

/** The index of a level at a given nominal concentration, for reading `recoveries` by hand. */
function indexAtConc(world: World, conc: number): number {
  const index = levels(world).findIndex((l) => l.concUgPerML === conc)
  if (index < 0) throw new Error(`no standard at ${conc} ug/mL in this scenario`)
  return index
}

// --- Given: the standards -------------------------------------------------

Given('the reference standards from the workbook', (world: World) => {
  setLevels(world, referenceLevels())
})

Given('{int} standard levels', (world: World, count: number) => {
  // The first `count` of the workbook's own standards, so a scenario about having too few of
  // them is not also a scenario about having odd ones.
  setLevels(world, referenceLevels().slice(0, count))
})

Given(
  '{int} standard levels whose absorbances are all {}',
  (world: World, count: number, text: string) => {
    const flat = number(text)
    setLevels(
      world,
      REFERENCE_CONCENTRATIONS.slice(0, count).map((conc, i) =>
        standardLevel(conc, [flat], REFERENCE_TUBE_IDS[i] as string),
      ),
    )
  },
)

Given('the reference standards without the blank level', (world: World) => {
  setLevels(
    world,
    referenceLevels().filter((l) => l.concUgPerML !== 0),
  )
})

Given('one level at {} ug\\/mL', (world: World, text: string) => {
  setLevels(world, [...levels(world), standardLevel(number(text), [0.5], 'Z')])
})

Given('a second level at {} ug\\/mL', (world: World, text: string) => {
  const conc = number(text)
  const twin = levels(world).find((l) => l.concUgPerML === conc)
  if (!twin) throw new Error(`no standard at ${conc} ug/mL to duplicate`)
  setLevels(world, [...levels(world), standardLevel(conc, twin.replicates, 'Z')])
})

Given('one level whose replicates are all empty', (world: World) => {
  // The 750 ug/mL level rather than the blank: dropping the blank would also raise
  // NO_BLANK_STANDARD, and the scenario is about a dropped level, not about blank handling.
  world.droppedConc = 750
  setLevels(
    world,
    levels(world).map((l) =>
      l.concUgPerML === 750 ? standardLevel(l.concUgPerML, [null, null], l.tubeId) : l,
    ),
  )
})

Given('each level given two replicates averaging to its reference absorbance', (world: World) => {
  setLevels(
    world,
    REFERENCE_CONCENTRATIONS.map((conc, i) => {
      const mean = REFERENCE_ABSORBANCES[i] as number
      return standardLevel(conc, [mean - 0.01, mean + 0.01], REFERENCE_TUBE_IDS[i])
    }),
  )
})

Given('standards whose absorbances are scrambled against their concentrations', (world: World) => {
  // A specific swap, not a shuffle: the 125 and 1500 ug/mL standards trade absorbances, so the
  // curve has to climb, fall back and climb again to reach all nine points. A random permutation
  // would sometimes be monotonic and this scenario would fail on some runs and not others.
  const scrambled = [...REFERENCE_ABSORBANCES]
  const low = 2
  const high = 7
  scrambled[low] = REFERENCE_ABSORBANCES[high] as number
  scrambled[high] = REFERENCE_ABSORBANCES[low] as number
  setLevels(
    world,
    REFERENCE_CONCENTRATIONS.map((conc, i) =>
      standardLevel(conc, [scrambled[i] as number], REFERENCE_TUBE_IDS[i] as string),
    ),
  )
})

Given('standards carrying enough noise to fit worse than {}', (world: World) => {
  // Alternating rather than random, for the same reason as the swap above. The size is chosen to
  // land clearly under the threshold instead of hovering on it, so a small change in the fitter
  // does not silently turn this scenario into a test of nothing.
  setLevels(
    world,
    REFERENCE_CONCENTRATIONS.map((conc, i) => {
      const noisy = (REFERENCE_ABSORBANCES[i] as number) + (i % 2 === 0 ? 0.18 : -0.18)
      return standardLevel(conc, [noisy], REFERENCE_TUBE_IDS[i])
    }),
  )
})

Given('the reference standards with one level moved far off the curve', (world: World) => {
  // The 500 ug/mL standard, read as if the well had held nearly twice as much protein. The
  // workbook's own 25 ug/mL standard already recovers badly, so the scenario has to name which
  // level it means and the assertion has to look for that one rather than for any.
  world.movedTube = 'E'
  setLevels(
    world,
    referenceLevels().map((l) =>
      l.concUgPerML === 500 ? standardLevel(l.concUgPerML, [1.2], l.tubeId) : l,
    ),
  )
})

Given('the reference standards with the blank reading {}', (world: World, text: string) => {
  const value = number(text)
  setLevels(
    world,
    referenceLevels().map((l) =>
      l.concUgPerML === 0 ? standardLevel(l.concUgPerML, [value], l.tubeId) : l,
    ),
  )
})

Given('a curve fit that produced no coefficients', (world: World) => {
  world.fit = fitCurve([])
})

// --- Given: the options ---------------------------------------------------

Given('blank subtraction is {}', (world: World, state: string) => {
  const value = state.trim()
  if (value !== 'on' && value !== 'off') throw new Error(`blank subtraction is "${value}"?`)
  world.blankSubtract = value === 'on'
})

Given('the {string} model', (world: World, label: string) => {
  world.model = model(label)
})

// --- When -----------------------------------------------------------------

When('the standard curve is fitted', (world: World) => {
  world.fit = runFit(world)
})

When('each model is fitted in turn', (world: World) => {
  world.byModel = {
    cubic: runFit(world, FitModel.INVERSE_CUBIC),
    quadratic: runFit(world, FitModel.INVERSE_QUADRATIC),
    linear: runFit(world, FitModel.INVERSE_LINEAR),
  }
})

When('a prediction is attempted', (world: World) => {
  try {
    world.predicted = predict(fit(world), 0.43)
  } catch (thrown) {
    world.thrown = thrown
  }
})

// --- Then: the fit itself -------------------------------------------------

/**
 * Registered here rather than in linalg.steps.ts, and reading whichever layer ran, because both
 * curve-fitting features assert coefficients in exactly these words and the step registry is
 * global. `producedCoefficients` is what lets one registration serve both.
 */
Then('the fitted coefficients are:', (world: World, table: { hashes: unknown }) => {
  const rows = (typeof table.hashes === 'function'
    ? (table.hashes as () => Record<string, string>[])()
    : table.hashes) as Record<string, string>[]
  const coefficients = producedCoefficients(world)
  expect(coefficients, 'the fit produced no coefficients at all').not.toBeNull()
  expect(coefficients as number[]).toHaveLength(rows.length)
  const produced = coefficients as number[]
  for (const row of rows) {
    const power = number(row.power as string)
    // Indexed by power, not by row position: the coefficients come back highest power first,
    // and reading them positionally would let a reversed order pass on a symmetric table.
    const index = produced.length - 1 - power
    const actual = produced[index] as number
    const expected = number(row.value as string)
    expect(
      isClose(actual, expected, 1e-9),
      `coefficient of x^${power} was ${actual}, wanted ${expected}`,
    ).toBe(true)
  }
})

Then('{int} coefficients are returned', (world: World, count: number) => {
  expect(fit(world).coefficients).toHaveLength(count)
})

/** Shared with polynomial-least-squares.feature; see the note on `producedCoefficients`. */
Then('no coefficients are produced', (world: World) => {
  expect(producedCoefficients(world), 'a refused fit answered with coefficients anyway').toBeNull()
})

Then('coefficients are produced', (world: World) => {
  // The point of a warning rather than an error: the researcher is told, and still gets a curve.
  expect(fit(world).fitted, 'a warning should leave the fit usable').toBe(true)
  expect(fit(world).coefficients.length).toBeGreaterThan(0)
})

Then('the coefficients equal those of the single-replicate fit', (world: World) => {
  const reference = referenceFit().coefficients
  fit(world).coefficients.forEach((c, i) => {
    expect(isClose(c, reference[i] as number, 1e-9), `coefficient ${i} drifted to ${c}`).toBe(true)
  })
})

Then('the fit uses {int} levels', (world: World, count: number) => {
  const used = fit(world).levelMeans.filter((m) => m !== null).length
  expect(used, 'levels that reached the fit').toBe(count)
})

// --- Then: predictions ----------------------------------------------------

/**
 * The optional "still" is what the blank-subtraction scenario leans on: subtraction shifts the
 * coefficients, and if it moved the predictions too then the two modes would not be reporting
 * the same assay. It is one step because the assertion is identical either way — written as a
 * regex because `predicting {} gives {}` would otherwise also match the "still" phrasing.
 */
Then(
  /^predicting (\S+) (?:still )?gives (\S+) ug\/mL$/,
  (world: World, absorbance: string, expected: string) => {
    expectAt(predict(fit(world), number(absorbance)), expected, `prediction at ${absorbance}`)
  },
)

Then('correcting {} gives {}', (world: World, absorbance: string, expected: string) => {
  expectAt(correct(fit(world), number(absorbance)), expected, `correction of ${absorbance}`)
})

Then('the prediction is refused as an unfitted curve', (world: World) => {
  expect(world.predicted, 'a curve with no coefficients answered anyway').toBeUndefined()
  expect(slot<unknown>(world, 'thrown')).toBeInstanceOf(CurveNotFittedError)
})

Then('the refusal names the issues that caused it', (world: World) => {
  // A bare "not fitted" sends the reader back to the screen to work out why; the codes that
  // stopped the fit are the only thing that answers the question.
  const message = (slot<Error>(world, 'thrown')).message
  expect(message, 'the refusal should name what went wrong').toContain(
    IssueCode.INSUFFICIENT_STANDARDS,
  )
})

// --- Then: the reported quality ------------------------------------------

Then('the mean blank absorbance is {}', (world: World, text: string) => {
  expectAt(fit(world).blankMeanAbs, text, 'mean blank absorbance')
})

Then('the fit reports that no blank was subtracted', (world: World) => {
  expect(fit(world).blankSubtracted, 'blank subtraction was claimed with no blank').toBe(false)
})

Then(
  'the calibrated range runs from {} to {} absorbance',
  (world: World, low: string, high: string) => {
    expectAt(fit(world).absMin, low, 'calibrated minimum')
    expectAt(fit(world).absMax, high, 'calibrated maximum')
  },
)

Then('the R squared is above {}', (world: World, text: string) => {
  expect(fit(world).rSquared as number).toBeGreaterThan(number(text))
})

Then('the linear R squared is below the cubic R squared', (world: World) => {
  const byModel = slot<Record<string, CurveFit>>(world, 'byModel')
  expect((byModel.linear as CurveFit).rSquared as number).toBeLessThan(
    (byModel.cubic as CurveFit).rSquared as number,
  )
})

Then('the curve is monotonic across its calibrated range', (world: World) => {
  expect(fit(world).monotonic, 'the curve doubles back inside its own range').toBe(true)
})

Then('the curve is not monotonic across its calibrated range', (world: World) => {
  expect(fit(world).monotonic).toBe(false)
})

Then('one recovery is reported per standard level', (world: World) => {
  // Aligned by position with `levels`, which is what lets the table on screen put a recovery on
  // the same row as the standard it belongs to.
  expect(fit(world).recoveries).toHaveLength(levels(world).length)
})

Then('the blank has no recovery', (world: World) => {
  // Not zero and not 100: recovery is predicted over nominal, and the blank's nominal is zero.
  expect(fit(world).recoveries[indexAtConc(world, 0)]).toBeNull()
})

Then(
  'the {} ug\\/mL standard recovers at about {} percent',
  (world: World, conc: string, expected: string) => {
    const recovery = fit(world).recoveries[indexAtConc(world, number(conc))]
    expect(recovery, `no recovery for the ${conc} ug/mL standard`).not.toBeNull()
    expect(recovery as number, `recovery at ${conc} ug/mL`).toBeCloseTo(number(expected), 0)
  },
)

Then(
  'every other standard recovers between {} and {} percent',
  (world: World, low: string, high: string) => {
    const current = fit(world)
    const offenders = current.recoveries
      .map((recovery, i) => ({ recovery, level: levels(world)[i] as StandardLevel }))
      .filter((r) => r.recovery !== null && r.level.concUgPerML !== 25)
      .filter((r) => (r.recovery as number) < number(low) || (r.recovery as number) > number(high))
      .map((r) => `${r.level.concUgPerML} ug/mL at ${(r.recovery as number).toFixed(1)}%`)
    expect(offenders, 'standards outside the recovery band').toEqual([])
  },
)

// --- Then: the guards -----------------------------------------------------

Then(
  'the fit is flagged {string} at {} severity',
  (world: World, code: string, level: string) => {
    expectIssue(fit(world).issues, code, level)
  },
)

Then(
  'the fit is flagged {string} at {} severity naming that level',
  (world: World, code: string, level: string) => {
    const tube = slot<string>(world, 'movedTube')
    const named = fit(world)
      .issues.filter((i: Issue) => i.code === code)
      .map((i: Issue) => i.field)
    expect(named, `${code} was raised, but not for the level that was moved`).toContain(tube)
    expectIssue(fit(world).issues, code, level)
  },
)

Then('the fit reports no issues at error severity', (world: World) => {
  expectNoErrors(fit(world).issues)
})

Then('the fit is not flagged {string}', (world: World, code: string) => {
  expectNoIssue(fit(world).issues, code)
})
