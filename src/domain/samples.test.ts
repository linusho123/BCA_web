import { describe, expect, it } from 'vitest'
import { fitCurve, standardLevel } from './curve'
import { IssueCode, Severity, hasCode } from './errors'
import { isClose } from './linalg'
import { referenceFit, referenceLevels, REFERENCE_SAMPLES } from './reference'
import { analyseSamples, type SampleInput } from './samples'

/** Proves features/samples/sample-back-calculation.feature. */

const one = (name: string, absorbance: number): SampleInput => ({ name, replicates: [absorbance] })

describe('the workbook samples', () => {
  it.each(REFERENCE_SAMPLES)('reproduces $name to 1e-9', (golden) => {
    const [result] = analyseSamples(referenceFit(), [one(golden.name, golden.absorbance)], {
      dilutionFactor: 2,
    })
    expect(result).toBeDefined()
    if (!result) return
    expect(isClose(result.concUgPerML as number, golden.concUgPerML, 1e-9)).toBe(true)
    expect(isClose(result.concUgPerUL as number, golden.concUgPerUL, 1e-9)).toBe(true)
  })

  it.each([
    { factor: 1, expected: 0.2664318544865975 },
    { factor: 10, expected: 2.664318544865975 },
  ])('scales the stock concentration linearly at a factor of $factor', ({ factor, expected }) => {
    const [result] = analyseSamples(referenceFit(), [one('MCF7', 0.43)], {
      dilutionFactor: factor,
    })
    expect(isClose(result?.concUgPerUL as number, expected, 1e-9)).toBe(true)
  })

  it('averages replicates before consulting the curve', () => {
    const [result] = analyseSamples(
      referenceFit(),
      [{ name: 'MCF7', replicates: [0.42, 0.43, 0.44] }],
      { dilutionFactor: 2 },
    )
    expect(result?.meanAbs).toBeCloseTo(0.43, 12)
    expect(isClose(result?.concUgPerML as number, 266.4318544865975, 1e-9)).toBe(true)
  })

  it('carries replicate quality through to the result', () => {
    const [result] = analyseSamples(referenceFit(), [
      { name: 'MCF7', replicates: [0.4, 0.55] },
    ])
    expect(result?.sdAbs).not.toBeNull()
    expect(result?.cvPercent).not.toBeNull()
    expect(hasCode(result?.issues ?? [], IssueCode.CV_WARN)).toBe(true)
  })

  it('preserves order and names', () => {
    const names = ['delta', 'alpha', 'charlie', 'bravo']
    const results = analyseSamples(
      referenceFit(),
      names.map((n) => one(n, 0.43)),
    )
    expect(results.map((r) => r.name)).toEqual(names)
  })

  it('gives the same answer through a blank-subtracted curve', () => {
    const subtracted = fitCurve(referenceLevels(), { blankSubtract: true })
    const [result] = analyseSamples(subtracted, [one('MCF7', 0.43)], { dilutionFactor: 2 })
    expect(isClose(result?.concUgPerML as number, 266.4318544865975, 1e-9)).toBe(true)
  })
})

describe('sample guards', () => {
  it.each([2.5, 0.05])('flags absorbance %s as extrapolated', (absorbance) => {
    const [result] = analyseSamples(referenceFit(), [one('Odd', absorbance)])
    expect(result?.extrapolated).toBe(true)
    expect(hasCode(result?.issues ?? [], IssueCode.EXTRAPOLATED)).toBe(true)
  })

  it('flags a reading below the blank', () => {
    const subtracted = fitCurve(referenceLevels(), { blankSubtract: true })
    const [result] = analyseSamples(subtracted, [one('Odd', 0.1)])
    expect(hasCode(result?.issues ?? [], IssueCode.BELOW_BLANK)).toBe(true)
  })

  it('flags a negative fitted concentration and keeps the value', () => {
    // The reference cubic has an intercept of -71.9, so it crosses zero somewhere above the
    // blank's own absorbance; well below the blank it returns a frankly negative number.
    const [result] = analyseSamples(referenceFit(), [one('Odd', 0.05)])
    expect(result?.concUgPerML as number).toBeLessThan(0)
    expect(hasCode(result?.issues ?? [], IssueCode.NEGATIVE_CONCENTRATION_RESULT)).toBe(true)
  })

  it('reports a sample with no readable replicate rather than dropping it', () => {
    const results = analyseSamples(referenceFit(), [
      { name: 'Ghost', replicates: [null, null, null] },
    ])
    expect(results).toHaveLength(1)
    expect(results[0]?.meanAbs).toBeNull()
    expect(results[0]?.concUgPerML).toBeNull()
    expect(hasCode(results[0]?.issues ?? [], IssueCode.NO_DATA)).toBe(true)
    expect(results[0]?.issues.find((i) => i.code === IssueCode.NO_DATA)?.severity).toBe(
      Severity.INFO,
    )
  })

  it.each([0, -2])('refuses a dilution factor of %s', (factor) => {
    const [result] = analyseSamples(referenceFit(), [one('MCF7', 0.43)], {
      dilutionFactor: factor,
    })
    expect(hasCode(result?.issues ?? [], IssueCode.DILUTION_FACTOR_INVALID)).toBe(true)
    expect(result?.concUgPerUL).toBeNull()
  })

  it('carries a failed curve through rather than throwing', () => {
    const failed = fitCurve([standardLevel(0, [0.1]), standardLevel(100, [0.2])], {
      blankSubtract: false,
    })
    expect(failed.fitted).toBe(false)
    const results = analyseSamples(failed, [one('MCF7', 0.43)])
    expect(hasCode(results[0]?.issues ?? [], IssueCode.CURVE_UNAVAILABLE)).toBe(true)
    expect(results[0]?.concUgPerML).toBeNull()
  })

  it('returns nothing for no samples', () => {
    expect(analyseSamples(referenceFit(), [])).toEqual([])
  })
})
