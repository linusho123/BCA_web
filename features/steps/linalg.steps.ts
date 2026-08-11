import { Given, Then, When } from 'quickpickle'
import { expect } from 'vitest'
import { InsufficientDataError, SingularMatrixError } from '~/domain/errors'
import { polyfit, polyval } from '~/domain/linalg'
import { REFERENCE_ABSORBANCES, REFERENCE_CONCENTRATIONS } from '~/domain/reference'
import { type World, number, numberList, slot } from '../support/world'

/** Proves features/curve-fitting/polynomial-least-squares.feature. */

/** The fitter's inputs, in the direction the assay fits them: concentration on absorbance. */
interface FitData {
  readonly xs: number[]
  readonly ys: number[]
}

const data = (world: World): FitData => slot<FitData>(world, 'fitData')

/** Sample a polynomial at evenly spaced points, so the fit has an exact answer to find. */
const sample = (coefficients: number[], count: number): FitData => {
  const xs = Array.from({ length: count }, (_, i) => -2 + (4 * i) / Math.max(count - 1, 1))
  return { xs, ys: xs.map((x) => polyval(coefficients, x)) }
}

/** The polynomials the feature names, spelled the way it spells them. */
const POLYNOMIALS: Record<string, number[]> = {
  '2x^3 - 3x^2 + 0.5x + 7': [2, -3, 0.5, 7],
  '4x + 1': [4, 1],
}

Given('the reference standard concentrations and absorbances', (world: World) => {
  // Absorbance is x and concentration is y: this is an inverse calibration, which is what makes
  // the coefficients comparable to the workbook's LINEST(conc, abs^{1,2,3}).
  world.fitData = { xs: [...REFERENCE_ABSORBANCES], ys: [...REFERENCE_CONCENTRATIONS] }
})

Given('the exact polynomial {string} sampled at {int} points', (
  world: World,
  spelling: string,
  count: number,
) => {
  const coefficients = POLYNOMIALS[spelling]
  if (!coefficients) throw new Error(`"${spelling}" is not a polynomial this feature defines`)
  world.polynomial = coefficients
  world.fitData = sample(coefficients, count)
})

/**
 * Written as a regex rather than as `the coefficients {}`, because a one-placeholder expression
 * starting with "the coefficients" also matches every other sentence about coefficients that any
 * feature file might open with — the step registry is shared across all of them.
 */
Given(/^the coefficients ([-\d.,eE+ ]+)$/, (world: World, list: string) => {
  world.coefficients = numberList(list)
})

Given('{int} standards whose absorbances are all {}', (
  world: World,
  count: number,
  absorbance: string,
) => {
  // No variance in x: the normal equations are rank-deficient, and every column of the design
  // beyond the constant is a multiple of the one before it.
  const x = number(absorbance)
  world.fitData = {
    xs: Array.from({ length: count }, () => x),
    ys: Array.from({ length: count }, (_, i) => 100 * (i + 1)),
  }
})

Given('{int} points of fitting data', (world: World, count: number) => {
  world.fitData = {
    xs: Array.from({ length: count }, (_, i) => 0.1 * (i + 1)),
    ys: Array.from({ length: count }, (_, i) => 100 * (i + 1)),
  }
})

Given('a fitting request that is {}', (world: World, defect: string) => {
  const defects: Record<string, { data: FitData; degree: number }> = {
    '5 x values and 4 y values': {
      data: { xs: [1, 2, 3, 4, 5], ys: [1, 2, 3, 4] },
      degree: 1,
    },
    'of degree -1': { data: sample([4, 1], 10), degree: -1 },
    'carrying a NaN in its x data': {
      data: { xs: [1, 2, NaN, 4, 5], ys: [1, 2, 3, 4, 5] },
      degree: 1,
    },
    'carrying an Infinity in y': {
      data: { xs: [1, 2, 3, 4, 5], ys: [1, 2, Infinity, 4, 5] },
      degree: 1,
    },
  }
  const found = defects[defect.trim()]
  if (!found) throw new Error(`"${defect}" is not a defect this feature sets up`)
  world.fitData = found.data
  world.degree = found.degree
})

/** Run the fit, keeping whatever it threw rather than letting it escape the step. */
const attempt = (world: World, degree: number): void => {
  world.degree = degree
  try {
    world.fitted = polyfit(data(world).xs, data(world).ys, degree)
    world.thrown = null
  } catch (error) {
    world.fitted = null
    world.thrown = error
  }
}

When('concentration is fitted on absorbance at degree {int}', (world: World, degree: number) => {
  attempt(world, degree)
})

When('the fit is attempted', (world: World) => {
  attempt(world, slot<number>(world, 'degree'))
})

When('the polynomial is evaluated at {}', (world: World, at: string) => {
  world.value = polyval(slot<number[]>(world, 'coefficients'), number(at))
})

When('the same degree-{int} fit is run forwards and backwards', (world: World, degree: number) => {
  const { xs, ys } = data(world)
  world.forwards = polyfit(xs, ys, degree)
  world.backwards = polyfit([...xs].reverse(), [...ys].reverse(), degree)
})

Then('the fitted curve passes through every supplied point', (world: World) => {
  // An exactly determined system has no residual to spread around: the fit is interpolation.
  const { xs, ys } = data(world)
  const coefficients = slot<number[]>(world, 'fitted')
  xs.forEach((x, i) => {
    expect(polyval(coefficients, x)).toBeCloseTo(ys[i] as number, 9)
  })
})

Then('the value is {}', (world: World, expected: string) => {
  expect(slot<number>(world, 'value')).toBeCloseTo(number(expected), 12)
})

Then('both runs return identical coefficients', (world: World) => {
  // Identical, not close: exact summation is what makes this hold, and a tolerance here would
  // pass even after the property it is testing had been lost.
  expect(slot<number[]>(world, 'forwards')).toEqual(slot<number[]>(world, 'backwards'))
})

Then('the fit is refused as a singular design', (world: World) => {
  // A named refusal, not a NaN: a rank-deficient design divides by a zero pivot, and a curve of
  // NaN coefficients would go on to report NaN concentrations for every sample on the plate.
  expect(world.thrown).toBeInstanceOf(SingularMatrixError)
})

Then('the fit is refused as insufficient data', (world: World) => {
  expect(world.thrown).toBeInstanceOf(InsufficientDataError)
})

Then('the request is rejected with {string}', (world: World, reason: string) => {
  // These are programming errors rather than user input — a caller handed the fitter the wrong
  // shape — so they are exceptions, and the message has to name which argument was wrong.
  const error = world.thrown as Error | null
  expect(error, 'the request was accepted').not.toBeNull()
  expect(error).toBeInstanceOf(RangeError)
  const patterns: Record<string, RegExp> = {
    'lengths must match': /same length/i,
    'degree must be positive': /degree must be a non-negative integer/i,
    'values must be finite': /is not finite/i,
  }
  const pattern = patterns[reason.trim()]
  if (!pattern) throw new Error(`"${reason}" is not a refusal this feature names`)
  expect(error?.message, `message was: ${error?.message}`).toMatch(pattern)
})

// `the fitted coefficients are:` and `no coefficients are produced` are shared with the standard
// curve's scenarios and are registered once, in curve.steps.ts, against the coefficients either
// layer produced.
