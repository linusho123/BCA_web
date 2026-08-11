import { describe, expect, it } from 'vitest'
import { IssueCode, Severity } from '~/domain/errors'
import {
  NonNegativeNumericText,
  NumericText,
  PositiveIntegerText,
  PositiveNumericText,
  parseNumericField,
} from './numeric'

/**
 * Supports every feature with a form field in it. The point of this boundary is that
 * `Number(raw)` is never called anywhere else, so the cases below are the ones that would
 * otherwise reach the domain wearing the wrong value.
 */

const value = (schema: { safeParse: (s: string) => { success: boolean; data?: number } }, raw: string) =>
  schema.safeParse(raw).data

const message = (
  schema: { safeParse: (s: string) => { success: boolean; error?: { issues: { message: string }[] } } },
  raw: string,
) => schema.safeParse(raw).error?.issues[0]?.message

describe('NumericText', () => {
  it.each([
    ['0.132', 0.132],
    ['2', 2],
    ['-0.004', -0.004],
    ['+2.5', 2.5],
    ['.5', 0.5],
    ['2.', 2],
    ['1e3', 1000],
    ['2.1E-2', 0.021],
    ['2000', 2000],
  ])('reads %s as %d', (raw, expected) => {
    expect(value(NumericText, raw)).toBe(expected)
  })

  it('ignores the whitespace that comes with a paste', () => {
    expect(value(NumericText, '  0.132\t')).toBe(0.132)
    expect(value(NumericText, '\n2\n')).toBe(2)
  })

  it('accepts a decimal comma, because that is how the number was read off the instrument', () => {
    // A German-locale laptop shows "0,132" on the reader and the researcher types it back the
    // same way. Refusing it would look like the app rejecting a number that is plainly a number.
    expect(value(NumericText, '0,132')).toBe(0.132)
    expect(value(NumericText, '-1,5')).toBe(-1.5)
    // A leading zero rules out the thousands reading, so three decimal places still parse.
    expect(value(NumericText, '0,750')).toBe(0.75)
  })

  it('refuses a comma that is a thousands separator rather than a decimal point', () => {
    // "1,000" means a thousand in one locale and one in another. Guessing costs three orders of
    // magnitude on a stock concentration, so it is refused and the user is asked to retype it.
    expect(message(NumericText, '1,000')).toContain('thousands separator')
    expect(message(NumericText, '1,234,567')).toContain('thousands separator')
    // Exactly three digits after the comma is the ambiguous shape; two or four are not.
    expect(value(NumericText, '1,00')).toBe(1)
    expect(value(NumericText, '1,0000')).toBe(1)
  })

  it('refuses an empty field instead of reading it as zero', () => {
    // Number('') is 0, which would silently become a stock concentration of zero.
    expect(message(NumericText, '')).toBe('a value is required')
    expect(message(NumericText, '   ')).toBe('a value is required')
  })

  it.each(['0x10', '0b11', '0o7', 'Infinity', '-Infinity', 'NaN', '1_000', '2 5', 'abc', '--1', '1.2.3'])(
    'refuses %s, which Number() would otherwise accept or mangle',
    (raw) => {
      // Number('0x10') is 16 and Number('Infinity') is Infinity; both would pass a
      // Number.isFinite check downstream having never been the number that was typed.
      expect(NumericText.safeParse(raw).success).toBe(false)
    },
  )

  it('refuses a value large enough to overflow to infinity', () => {
    expect(message(NumericText, '1e400')).toBe('must be a finite number')
  })
})

describe('the constrained variants', () => {
  it('PositiveNumericText refuses zero and below', () => {
    // A stock concentration or a well volume of zero divides by zero downstream.
    expect(value(PositiveNumericText, '0.001')).toBe(0.001)
    expect(message(PositiveNumericText, '0')).toBe('must be greater than zero')
    expect(message(PositiveNumericText, '-1')).toBe('must be greater than zero')
  })

  it('NonNegativeNumericText allows zero, which is a real concentration', () => {
    expect(value(NonNegativeNumericText, '0')).toBe(0)
    expect(message(NonNegativeNumericText, '-0.5')).toBe('must not be negative')
  })

  it('PositiveIntegerText refuses a fractional count of replicates', () => {
    expect(value(PositiveIntegerText, '3')).toBe(3)
    expect(message(PositiveIntegerText, '2.5')).toBe('must be a whole number of at least one')
    expect(message(PositiveIntegerText, '0')).toBe('must be a whole number of at least one')
  })

  it('keeps the base refusals through the added constraint', () => {
    expect(message(PositiveNumericText, '')).toBe('a value is required')
    expect(message(PositiveIntegerText, 'three')).toBe('must be a number')
  })
})

describe('parseNumericField', () => {
  it('returns the number and no issues when the field reads', () => {
    expect(parseNumericField(PositiveNumericText, ' 2,1 ', 'stock')).toEqual({
      value: 2.1,
      issues: [],
    })
  })

  it('reports a refusal as an issue rather than throwing', () => {
    // The domain reports failures as data so a panel degrades instead of blanking; a form field
    // that threw would be the one place in the app that behaves differently.
    const { value: parsed, issues } = parseNumericField(PositiveNumericText, 'abc', 'stock')
    expect(parsed).toBeNull()
    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe(IssueCode.NON_NUMERIC_INPUT)
    expect(issues[0]?.severity).toBe(Severity.ERROR)
  })

  it('names the field, so the form can mark the input that is wrong', () => {
    const { issues } = parseNumericField(PositiveNumericText, '0', 'wellVolume')
    expect(issues[0]?.field).toBe('wellVolume')
    expect(issues[0]?.message).toContain('wellVolume')
  })

  it('quotes the offending text back, so the message says what was wrong with it', () => {
    const { issues } = parseNumericField(NumericText, '1,000', 'stock')
    expect(issues[0]?.message).toContain('thousands separator')
    expect(issues[0]?.message).toContain('"1,000"')
    expect(issues[0]?.context.find(([k]) => k === 'raw')?.[1]).toBe('1,000')
  })
})
