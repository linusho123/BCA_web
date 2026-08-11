/**
 * Polynomial least squares.
 *
 * Ported from BCA_quarto `src/bca/linalg.py` / `assets/bca/linalg.js` (specdoc §3.2).
 *
 * The standard curve is fitted with Excel's LINEST(conc, abs^{1,2,3}), and the whole claim of
 * this app is that it reproduces that to a relative error around 1e-15 — close enough that a
 * result computed here reconciles with one computed in the spreadsheet years ago.
 *
 * Two implementation details carry that claim and neither is optional:
 *
 * `fsum` is Shewchuk exact summation, a port of CPython's `math.fsum`. The normal equations
 * accumulate power sums up to x^6, which span many orders of magnitude, so cancellation there
 * is precisely the case exact summation exists to fix. A naive `reduce((a, b) => a + b)` loses
 * digits exactly where this matters.
 *
 * `ipow` is repeated multiplication rather than `Math.pow`. `pow` is not correctly rounded in
 * any engine, and the inputs this module sees include values where it is off by one ulp —
 * enough to move a fitted coefficient in the twelfth digit.
 */

import { InsufficientDataError, SingularMatrixError } from './errors'

/**
 * Below this pivot magnitude the design is treated as rank-deficient. Chosen well above
 * double-precision noise but far below any pivot a real standard curve produces.
 */
const PIVOT_EPSILON = 1e-300

/** `x ** exponent` for small non-negative integer exponents, by repeated multiplication. */
export function ipow(x: number, exponent: number): number {
  let result = 1
  for (let i = 0; i < exponent; i++) result *= x
  return result
}

/**
 * Exact summation of an array of doubles — a port of CPython's `math.fsum`.
 *
 * Keeps a list of non-overlapping partial sums, each exact, and combines them at the end. The
 * result is the correctly rounded true sum, so it does not depend on the order of the input.
 * That order-independence is itself specified: see "Reversing the point order does not change
 * the coefficients" in features/curve-fitting/polynomial-least-squares.feature.
 */
export function fsum(values: readonly number[]): number {
  const partials: number[] = []
  let n = 0
  // Declared without initialisers: every one of them is written before it is read, and a zero
  // sitting here would only be a value the algorithm never sees.
  let x: number
  let y: number
  let hi: number
  let lo: number

  for (const value of values) {
    x = value
    let i = 0
    for (let j = 0; j < n; j++) {
      y = partials[j] as number
      if (Math.abs(x) < Math.abs(y)) {
        const t = x
        x = y
        y = t
      }
      hi = x + y
      lo = y - (hi - x)
      if (lo !== 0) partials[i++] = lo
      x = hi
    }
    n = i
    partials[n++] = x
    partials.length = n
  }

  // Sum the partials from the top down, stopping at the first inexact step.
  hi = 0
  if (n > 0) {
    hi = partials[--n] as number
    lo = 0
    while (n > 0) {
      x = hi
      y = partials[--n] as number
      hi = x + y
      lo = y - (hi - x)
      if (lo !== 0) break
    }
    // Make half-even rounding work across multiple partials, so that e.g. [1e-16, 1, 1e16]
    // rounds the last digit up rather than down. Without this the result would depend on
    // summation order and the commutativity above would be lost.
    const next = n > 0 ? (partials[n - 1] as number) : 0
    if (n > 0 && ((lo < 0 && next < 0) || (lo > 0 && next > 0))) {
      y = lo * 2
      x = hi + y
      if (y === x - hi) hi = x
    }
  }
  return hi
}

function validate(xs: readonly number[], ys: readonly number[], degree: number): void {
  if (!Number.isInteger(degree) || degree < 0) {
    throw new RangeError(`degree must be a non-negative integer, got ${degree}`)
  }
  if (xs.length !== ys.length) {
    throw new RangeError(`xs and ys must be the same length, got ${xs.length} and ${ys.length}`)
  }
  if (xs.length === 0) {
    throw new InsufficientDataError('no data points supplied')
  }
  if (xs.length < degree + 1) {
    throw new InsufficientDataError(
      `a degree-${degree} fit needs at least ${degree + 1} points, got ${xs.length}`,
    )
  }
  for (const [name, seq] of [
    ['xs', xs],
    ['ys', ys],
  ] as const) {
    for (let i = 0; i < seq.length; i++) {
      const v = seq[i] as number
      if (!Number.isFinite(v)) throw new RangeError(`${name}[${i}] is not finite: ${v}`)
    }
  }
}

/**
 * Least-squares polynomial fit of `ys` against `xs`.
 *
 * Returns coefficients highest power first, matching `numpy.polyfit` ordering, so a cubic
 * returns `[a, b, c, d]` for `y = a*x^3 + b*x^2 + c*x + d`.
 *
 * Solves the normal equations by Gaussian elimination with partial pivoting. That is not the
 * numerically strongest choice available in the abstract — a QR factorisation is better
 * conditioned — but it is what Excel's LINEST does, and matching LINEST is the requirement.
 */
export function polyfit(xs: readonly number[], ys: readonly number[], degree: number): number[] {
  validate(xs, ys, degree)
  const n = degree + 1

  // A c = b, where A[i][j] = sum(x^(2*degree - i - j)) and b[i] = sum(y * x^(degree - i)).
  // Indexing by descending power keeps the returned coefficient order aligned with numpy's
  // without a final reversal.
  const matrix: number[][] = []
  for (let i = 0; i < n; i++) {
    const row: number[] = []
    for (let j = 0; j < n; j++) {
      const terms = xs.map((x) => ipow(x, 2 * degree - i - j))
      row.push(fsum(terms))
    }
    matrix.push(row)
  }

  const rhs: number[] = []
  for (let i = 0; i < n; i++) {
    const terms = xs.map((x, k) => (ys[k] as number) * ipow(x, degree - i))
    rhs.push(fsum(terms))
  }

  for (let col = 0; col < n; col++) {
    let pivotRow = col
    for (let r = col; r < n; r++) {
      const candidate = Math.abs((matrix[r] as number[])[col] as number)
      if (candidate > Math.abs((matrix[pivotRow] as number[])[col] as number)) pivotRow = r
    }
    if (Math.abs((matrix[pivotRow] as number[])[col] as number) < PIVOT_EPSILON) {
      throw new SingularMatrixError(
        `design matrix is rank-deficient at column ${col}; ` +
          'the x values may be identical or collinear for this degree',
      )
    }
    if (pivotRow !== col) {
      const tmpRow = matrix[col] as number[]
      matrix[col] = matrix[pivotRow] as number[]
      matrix[pivotRow] = tmpRow
      const tmpRhs = rhs[col] as number
      rhs[col] = rhs[pivotRow] as number
      rhs[pivotRow] = tmpRhs
    }

    const pivotRowValues = matrix[col] as number[]
    const pivot = pivotRowValues[col] as number
    for (let row = col + 1; row < n; row++) {
      const target = matrix[row] as number[]
      const factor = (target[col] as number) / pivot
      if (factor === 0) continue
      for (let k = col; k < n; k++) {
        target[k] = (target[k] as number) - factor * (pivotRowValues[k] as number)
      }
      rhs[row] = (rhs[row] as number) - factor * (rhs[col] as number)
    }
  }

  const coefficients = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    const row = matrix[i] as number[]
    const terms: number[] = []
    for (let j = i + 1; j < n; j++) terms.push((row[j] as number) * (coefficients[j] as number))
    coefficients[i] = ((rhs[i] as number) - fsum(terms)) / (row[i] as number)
  }

  return coefficients
}

/** Evaluate a polynomial given highest-power-first coefficients, by Horner's method. */
export function polyval(coefficients: readonly number[], x: number): number {
  let result = 0
  for (const c of coefficients) result = result * x + c
  return result
}

/**
 * Coefficient of determination of `coefficients` predicting `ys` from `xs`.
 *
 * Returns 1 when the observations have no variance and the fit reproduces them exactly: in
 * that degenerate case the model explains everything there is to explain.
 */
export function rSquared(
  xs: readonly number[],
  ys: readonly number[],
  coefficients: readonly number[],
): number {
  if (ys.length === 0) throw new InsufficientDataError('no observations to score')
  const meanY = fsum(ys) / ys.length
  const ssRes = fsum(ys.map((y, i) => ipow(y - polyval(coefficients, xs[i] as number), 2)))
  const ssTot = fsum(ys.map((y) => ipow(y - meanY, 2)))
  if (ssTot === 0) return ssRes === 0 ? 1 : 0
  return 1 - ssRes / ssTot
}

/** Relative closeness, matching Python's `math.isclose` with `abs_tol` of zero. */
export function isClose(a: number, b: number, relTol = 1e-9): boolean {
  if (a === b) return true
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.abs(a - b) <= relTol * Math.max(Math.abs(a), Math.abs(b))
}
