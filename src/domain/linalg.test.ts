import { describe, expect, it } from 'vitest'
import { InsufficientDataError, SingularMatrixError } from './errors'
import { fsum, ipow, isClose, polyfit, polyval, rSquared } from './linalg'
import { EXCEL_COEFFICIENTS, REFERENCE_ABSORBANCES, REFERENCE_CONCENTRATIONS } from './reference'

/** Proves features/curve-fitting/polynomial-least-squares.feature. */

const relClose = (actual: number, expected: number, relTol: number): boolean =>
  isClose(actual, expected, relTol)

describe('polyfit against the workbook', () => {
  it('reproduces the Excel LINEST cubic coefficients', () => {
    const coefficients = polyfit(REFERENCE_ABSORBANCES, REFERENCE_CONCENTRATIONS, 3)
    expect(coefficients).toHaveLength(4)
    coefficients.forEach((c, i) => {
      expect(relClose(c, EXCEL_COEFFICIENTS[i] as number, 1e-9)).toBe(true)
    })
  })

  it('agrees with Excel far inside the tolerance the contract asks for', () => {
    const coefficients = polyfit(REFERENCE_ABSORBANCES, REFERENCE_CONCENTRATIONS, 3)
    const worst = Math.max(
      ...coefficients.map((c, i) => {
        const expected = EXCEL_COEFFICIENTS[i] as number
        return Math.abs(c - expected) / Math.abs(expected)
      }),
    )
    // Measured at 1.2704259326752738e-13, which is bit-for-bit what BCA_quarto's Python core
    // produces for the same inputs — checked by running src/bca/linalg.py against this data.
    //
    // Note that BCA_quarto's specdoc §3.2 claims 6.9e-15 for that same solver. That claim does
    // not survive being run: the true figure is two orders of magnitude larger. It is still far
    // inside the 1e-9 the feature file asks for, so nothing downstream is affected, but the
    // number is pinned here at its real value rather than the documented one.
    expect(worst).toBeLessThan(2e-13)
  })
})

describe('polyfit on noise-free data', () => {
  const xs = Array.from({ length: 10 }, (_, i) => i * 0.37 - 1.2)

  it('recovers an exact cubic', () => {
    const ys = xs.map((x) => 2 * x ** 3 - 3 * x ** 2 + 0.5 * x + 7)
    const coefficients = polyfit(xs, ys, 3)
    const expected = [2, -3, 0.5, 7]
    coefficients.forEach((c, i) => expect(c).toBeCloseTo(expected[i] as number, 6))
  })

  it('recovers an exact line at degree 1', () => {
    const ys = xs.map((x) => 4 * x + 1)
    const coefficients = polyfit(xs, ys, 1)
    expect(coefficients[0]).toBeCloseTo(4, 9)
    expect(coefficients[1]).toBeCloseTo(1, 9)
  })

  it('passes through every point when exactly determined', () => {
    const four = xs.slice(0, 4)
    const ys = four.map((x) => 2 * x ** 3 - 3 * x ** 2 + 0.5 * x + 7)
    const coefficients = polyfit(four, ys, 3)
    four.forEach((x, i) => expect(polyval(coefficients, x)).toBeCloseTo(ys[i] as number, 6))
  })
})

describe('polyval', () => {
  it('reads coefficients highest power first', () => {
    expect(polyval([2, -3, 0.5, 7], 2)).toBe(12)
  })

  it('returns the constant term for an empty polynomial evaluated anywhere', () => {
    expect(polyval([5], 1000)).toBe(5)
  })
})

describe('summation is order-independent', () => {
  it('gives identical coefficients forwards and backwards', () => {
    const forwards = polyfit(REFERENCE_ABSORBANCES, REFERENCE_CONCENTRATIONS, 3)
    const backwards = polyfit(
      [...REFERENCE_ABSORBANCES].reverse(),
      [...REFERENCE_CONCENTRATIONS].reverse(),
      3,
    )
    expect(backwards).toEqual(forwards)
  })

  it('sums exactly where a naive reduce would not', () => {
    // The classic: a naive left fold gives 0 or 2 depending on order. fsum gives 2 either way.
    const values = [1e100, 1, -1e100, 1]
    expect(fsum(values)).toBe(2)
    expect(fsum([...values].reverse())).toBe(2)
  })
})

describe('ipow', () => {
  it('agrees with repeated multiplication rather than libm rounding', () => {
    expect(ipow(0.75000000000000011, 2)).toBe(0.75000000000000011 * 0.75000000000000011)
  })

  it('returns 1 for a zero exponent', () => {
    expect(ipow(0, 0)).toBe(1)
  })
})

describe('rSquared', () => {
  it('scores the reference curve above 0.998', () => {
    const coefficients = polyfit(REFERENCE_ABSORBANCES, REFERENCE_CONCENTRATIONS, 3)
    expect(rSquared(REFERENCE_ABSORBANCES, REFERENCE_CONCENTRATIONS, coefficients)).toBeGreaterThan(
      0.998,
    )
  })

  it('returns 1 when the observations have no variance and the fit reproduces them', () => {
    expect(rSquared([1, 2, 3], [5, 5, 5], [0, 5])).toBe(1)
  })

  it('returns 0 when the observations have no variance and the fit misses', () => {
    expect(rSquared([1, 2, 3], [5, 5, 5], [0, 9])).toBe(0)
  })
})

describe('refusals', () => {
  it('refuses a rank-deficient design as singular, not as a division by zero', () => {
    const xs = [0.5, 0.5, 0.5, 0.5, 0.5]
    expect(() => polyfit(xs, [1, 2, 3, 4, 5], 3)).toThrow(SingularMatrixError)
  })

  it.each([
    { points: 0, degree: 3 },
    { points: 3, degree: 3 },
    { points: 1, degree: 1 },
  ])('refuses $points points at degree $degree as insufficient', ({ points, degree }) => {
    const xs = Array.from({ length: points }, (_, i) => i)
    expect(() => polyfit(xs, xs, degree)).toThrow(InsufficientDataError)
  })

  it('refuses mismatched lengths', () => {
    expect(() => polyfit([1, 2, 3, 4, 5], [1, 2, 3, 4], 1)).toThrow(/same length/)
  })

  it('refuses a negative degree', () => {
    expect(() => polyfit([1, 2, 3, 4], [1, 2, 3, 4], -1)).toThrow(/non-negative/)
  })

  it.each([NaN, Infinity, -Infinity])('refuses %s in the data rather than propagating it', (v) => {
    expect(() => polyfit([1, 2, 3, v], [1, 2, 3, 4], 1)).toThrow(/not finite/)
    expect(() => polyfit([1, 2, 3, 4], [1, 2, 3, v], 1)).toThrow(/not finite/)
  })

  it('refuses to score no observations', () => {
    expect(() => rSquared([], [], [1])).toThrow(InsufficientDataError)
  })
})
