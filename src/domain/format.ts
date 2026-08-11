/**
 * Number formatting for issue messages, tables and CSV.
 *
 * DEVIATION FROM THE SOURCE PROJECT. BCA_quarto's `assets/bca/constants.js` carries some 150
 * lines reimplementing Python's `format(x, '.3f')`, `format(x, 'g')`, `repr()` and
 * `round(x, n)` in JavaScript, because it shipped the same app twice — once under Pyodide,
 * once in hand-written JS — and `tests/test_js_parity.py` compared the two runtimes' issue
 * messages byte for byte. There is one runtime here, so that whole layer is dead weight and
 * has been dropped.
 *
 * What is kept is `fixed()`, and not for parity: half-even rounding is the right rounding for
 * volumes. `toFixed` rounds exact ties away from zero, and derived volumes hit exact ties
 * routinely — 157.5 x 0.75 is exactly 118.125, which `toFixed(2)` reports as 118.13 while
 * banker's rounding gives 118.12. Rounding every tie up biases a column of pipetting volumes
 * upward, which is the direction that runs a vial dry.
 */

/**
 * Format with `digits` decimal places, rounding exact ties to even.
 *
 * The tie test reads the value's exact decimal expansion. A double is a dyadic rational so its
 * expansion terminates, and it can only sit exactly on a tie if every digit past `digits` is a
 * "5" followed by zeros — which shows itself within the 20 fractional digits `toFixed` will
 * produce, for every magnitude this app formats.
 */
export function fixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (Math.abs(value) >= 1e21) return value.toExponential(Math.max(0, digits))

  let out = value.toFixed(digits)

  const exact = value.toFixed(20)
  const point = exact.indexOf('.')
  const tail = exact.slice(point + 1).slice(digits)
  if (/^50*$/.test(tail)) {
    const kept = exact.slice(0, point + (digits > 0 ? digits + 1 : 0))
    const lastDigit = kept.charCodeAt(kept.length - 1) - 48
    if (lastDigit % 2 === 0) {
      out = kept
    } else {
      const step = (value < 0 ? -1 : 1) * 10 ** -digits
      out = (parseFloat(kept) + step).toFixed(digits)
    }
  }

  // A negative value that rounds to zero keeps its sign; so does negative zero itself, which
  // `toFixed` silently drops. A plate well can read -0.
  if (Object.is(value, -0)) out = `-${out}`
  return out
}

/**
 * The shortest string that round-trips back to `value` — the form for a CSV cell, where the
 * point is that a reader can reconstruct the double exactly.
 */
export function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (Number.isNaN(value)) return 'NaN'
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity'
  return String(value)
}

/**
 * Thousands-grouped, for anything a reader reads rather than re-parses.
 * Axis ticks and readouts go through here; CSV cells never do.
 */
export function grouped(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return String(value)
  const [whole = '0', frac] = fixed(value, digits).split('.')
  const sign = whole.startsWith('-') ? '-' : ''
  const body = sign ? whole.slice(1) : whole
  const withSeparators = body.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac ? `${sign}${withSeparators}.${frac}` : `${sign}${withSeparators}`
}

/**
 * A dilution factor, as a multiplier a person can act on: "2×", "1.333×", "5×".
 *
 * `num()` is wrong here even though a dilution factor is a number a reader might re-enter. Most
 * factors in a series are small integers, but any level whose concentration is not a clean
 * fraction of its source produces a factor no decimal spells exactly — 2000 → 1500 is 4/3, and
 * `num()` prints it as "1.3333333333333333". In a column whose other rows read "2" that width
 * claims a precision nobody pipettes at, and it is the widest thing in the table.
 *
 * Three decimals, with trailing zeros dropped so an integer factor stays an integer. Enough to
 * distinguish 1.333 from 1.5 and from 1.25, which is the whole job a reader has here.
 */
export function ratio(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const at3 = fixed(value, 3)
  const trimmed = at3.includes('.') ? at3.replace(/0+$/, '').replace(/\.$/, '') : at3
  return `${trimmed}×`
}

/** A percentage for display, at one decimal place. */
export function percent(value: number | null): string {
  return value === null ? '' : `${fixed(value, 1)}%`
}
