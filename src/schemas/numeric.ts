/**
 * The numeric boundary.
 *
 * Every number in this app arrives as a string: typed into a form field, pasted from a reader,
 * or read back out of localStorage. `Number('')` is 0 and `Number('0x10')` is 16, so a bare
 * coercion here would invent a stock concentration of zero from an empty field and an
 * absorbance of 16 from a hex-looking typo.
 *
 * These schemas are the one place that conversion happens, and they fail loudly. Everything
 * downstream of them takes real numbers and can say so in its types.
 */

import { z } from 'zod'
import { type Issue, IssueCode, Severity, issue } from '~/domain/errors'

/** Digits, one optional decimal point, an optional exponent. Nothing else. */
const DECIMAL_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i

/** A single comma with something other than exactly three digits after it: unambiguously decimal. */
const DECIMAL_COMMA_RE = /^[+-]?\d+,\d+$/

/**
 * A comma this app will not guess at: `1,000` is a thousand under one locale and one under
 * another, and picking wrong puts a stock concentration out by three orders of magnitude.
 * Groups of exactly three digits are the shape that is ambiguous. A leading zero rules the
 * reading out — nobody writes a thousand-grouped number as `0,132` — so the absorbances that
 * actually get typed with a decimal comma still go through.
 */
const THOUSANDS_RE = /^[+-]?[1-9]\d{0,2}(,\d{3})+$/

/**
 * A number typed by a person: trimmed, comma-decimal tolerated, everything else refused.
 *
 * The decimal comma is not politeness. A researcher with a German locale on their laptop reads
 * "0,132" off the instrument and types it back the same way, and rejecting it would look like
 * the app refusing a number that is plainly a number.
 */
export const NumericText = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => s !== '', { message: 'a value is required' })
  .refine((s) => !THOUSANDS_RE.test(s), {
    message:
      'that comma could be a decimal point or a thousands separator; write it without the comma',
  })
  .transform((s) => (DECIMAL_COMMA_RE.test(s) ? s.replace(',', '.') : s))
  .refine((s) => DECIMAL_RE.test(s), { message: 'must be a number' })
  .transform((s) => Number(s))
  .refine((n) => Number.isFinite(n), { message: 'must be a finite number' })

export const PositiveNumericText = NumericText.refine((n) => n > 0, {
  message: 'must be greater than zero',
})

export const NonNegativeNumericText = NumericText.refine((n) => n >= 0, {
  message: 'must not be negative',
})

export const PositiveIntegerText = NumericText.refine((n) => Number.isInteger(n) && n >= 1, {
  message: 'must be a whole number of at least one',
})

/**
 * Parse a typed value, returning an `Issue` rather than throwing.
 *
 * The domain reports failures as data so a panel degrades instead of blanking; the boundary
 * has to speak the same language or the form fields would be the one place in the app that
 * throws. `field` names the input so the form can mark it.
 */
export function parseNumericField(
  schema: z.ZodType<number, string>,
  raw: string,
  field: string,
): { value: number | null; issues: Issue[] } {
  const result = schema.safeParse(raw)
  if (result.success) return { value: result.data, issues: [] }
  const first = result.error.issues[0]
  return {
    value: null,
    issues: [
      issue(
        IssueCode.NON_NUMERIC_INPUT,
        Severity.ERROR,
        `${field}: ${first?.message ?? 'is not a number'} (got "${raw}")`,
        field,
        { raw },
      ),
    ],
  }
}
