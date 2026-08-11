import { describe, expect, it } from 'vitest'
import { fixed, grouped, num, percent } from './format'

/**
 * Supports every feature that quotes a number back to the user. `fixed` is the load-bearing one:
 * half-even rounding is what keeps a column of derived pipetting volumes from drifting upward.
 */

describe('fixed', () => {
  it.each([
    [0.132, 3, '0.132'],
    [1.5, 0, '2'],
    [2.5, 0, '2'],
    [3.5, 0, '4'],
    [-1.5, 0, '-2'],
    [-2.5, 0, '-2'],
    [0, 2, '0.00'],
    [2000, 1, '2000.0'],
  ])('formats %d to %d places as %s', (value, digits, expected) => {
    expect(fixed(value, digits)).toBe(expected)
  })

  it('rounds an exact tie to even rather than away from zero', () => {
    // 157.5 * 0.75 is exactly 118.125. toFixed gives 118.13; rounding every tie up biases a
    // column of volumes in the direction that runs a vial dry.
    expect(157.5 * 0.75).toBe(118.125)
    expect(fixed(118.125, 2)).toBe('118.12')
    expect((118.125).toFixed(2)).toBe('118.13')
    expect(fixed(118.135, 2)).toBe('118.14')
  })

  it('rounds a value that only looks like a tie by its shortest spelling as the double it is', () => {
    // 1.005 is really 1.00499999999999989...; treating it as a tie would round it up on a value
    // that is genuinely below the midpoint.
    expect(fixed(1.005, 2)).toBe('1.00')
    expect(fixed(0.615, 2)).toBe('0.61')
  })

  it('keeps the sign on a negative value that rounds to zero', () => {
    // A plate well can read -0.004. Reporting it as "0.00" hides the sign, which is the one
    // thing about that reading worth noticing.
    expect(fixed(-0.004, 2)).toBe('-0.00')
    expect(fixed(-0, 2)).toBe('-0.00')
  })

  it.each([
    [NaN, 'NaN'],
    [Infinity, 'Infinity'],
    [-Infinity, '-Infinity'],
  ])('passes %s through rather than formatting it', (value, expected) => {
    expect(fixed(value, 3)).toBe(expected)
  })

  it('falls back to exponential past the range where a fixed expansion is meaningful', () => {
    expect(fixed(1e21, 2)).toContain('e+21')
  })
})

describe('num', () => {
  it('writes the shortest string that reads back as the same double', () => {
    const value = 266.4318544865975
    expect(Number(num(value))).toBe(value)
    expect(num(0.1 + 0.2)).toBe('0.30000000000000004')
  })

  it('writes an absent number as an empty cell rather than as "null"', () => {
    expect(num(null)).toBe('')
    expect(num(undefined)).toBe('')
  })

  it.each([
    [NaN, 'NaN'],
    [Infinity, 'Infinity'],
    [-Infinity, '-Infinity'],
  ])('names %s rather than emitting an empty cell for it', (value, expected) => {
    expect(num(value)).toBe(expected)
  })
})

describe('grouped', () => {
  it.each([
    [2000, 0, '2,000'],
    [999, 0, '999'],
    [1000000, 0, '1,000,000'],
    [-1234567, 0, '-1,234,567'],
    [1234.5, 1, '1,234.5'],
    [0, 0, '0'],
  ])('groups %d to %s', (value, digits, expected) => {
    expect(grouped(value, digits)).toBe(expected)
  })

  it('rounds the way fixed does before grouping', () => {
    expect(grouped(2500.5, 0)).toBe('2,500')
  })

  it('passes a non-finite value through', () => {
    expect(grouped(NaN)).toBe('NaN')
  })
})

describe('percent', () => {
  it.each([
    [100, '100.0%'],
    [1.4002, '1.4%'],
    [0, '0.0%'],
  ])('writes %d as %s', (value, expected) => {
    expect(percent(value)).toBe(expected)
  })

  it('writes an absent percentage as an empty cell', () => {
    expect(percent(null)).toBe('')
  })
})
