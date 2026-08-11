import { describe, expect, it } from 'vitest'
import { IssueCode, Severity, hasCode } from './errors'
import { replicateStats } from './qc'

/** Proves features/qc/replicate-statistics.feature. */

const codesOf = (issues: readonly { code: IssueCode }[]) => issues.map((i) => i.code)

describe('ordinary replicate statistics', () => {
  it.each([
    { values: [0.5, 0.51], n: 2, mean: 0.505, cv: 1.4002 },
    { values: [0.43, 0.44, 0.45], n: 3, mean: 0.44, cv: 2.2727 },
  ])('reports $n replicates with a CV near $cv percent', ({ values, n, mean, cv }) => {
    const stats = replicateStats(values)
    expect(stats.n).toBe(n)
    expect(stats.mean as number).toBeCloseTo(mean, 12)
    expect(stats.cvPercent as number).toBeCloseTo(cv, 3)
    expect(stats.issues).toEqual([])
  })

  it('matches the ordinary sample statistics on a longer set', () => {
    const values = [0.41, 0.52, 0.38, 0.47, 0.55, 0.49, 0.44, 0.51, 0.39, 0.46]
    const stats = replicateStats(values)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1)
    expect(stats.mean as number).toBeCloseTo(mean, 12)
    expect(stats.sd as number).toBeCloseTo(Math.sqrt(variance), 12)
  })

  it('excludes empty wells before counting', () => {
    const stats = replicateStats([0.5, null, 0.52, null])
    expect(stats.n).toBe(2)
    expect(stats.mean as number).toBeCloseTo(0.51, 12)
  })
})

describe('the CV thresholds', () => {
  it('does not warn below the threshold', () => {
    // cv% = 100 * |b - a| / (sqrt(2) * mean) = 14.142... for this pair.
    const stats = replicateStats([0.9, 1.1])
    expect(stats.cvPercent as number).toBeLessThan(15)
    expect(stats.issues).toEqual([])
  })

  it('is exclusive at the boundary: the warning tracks cv > 15 and not cv >= 15', () => {
    // A CV of exactly 15 needs |b - a| = 0.15 * sqrt(2) * mean, which is irrational; no pair of
    // doubles lands on the boundary, and the closest ones sit a few parts in 1e15 either side.
    // So the boundary is asserted as the property it is, across the points that straddle it,
    // rather than by trying to hit a value the number system cannot represent.
    const delta = (15 * Math.SQRT2) / 100
    for (const scale of [1 - 1e-12, 1 - 1e-15, 1, 1 + 1e-15, 1 + 1e-12]) {
      const spread = (delta * scale) / 2
      const stats = replicateStats([1 - spread, 1 + spread])
      const cv = stats.cvPercent as number
      expect(cv).toBeCloseTo(15, 9)
      expect(hasCode(stats.issues, IssueCode.CV_WARN)).toBe(cv > 15)
    }
  })

  it('is exclusive at the failure boundary too', () => {
    const delta = (25 * Math.SQRT2) / 100
    for (const scale of [1 - 1e-12, 1, 1 + 1e-12]) {
      const spread = (delta * scale) / 2
      const stats = replicateStats([1 - spread, 1 + spread])
      const cv = stats.cvPercent as number
      expect(cv).toBeCloseTo(25, 9)
      expect(hasCode(stats.issues, IssueCode.CV_FAIL)).toBe(cv > 25)
    }
  })

  it.each([
    { values: [0.4, 0.55], code: IssueCode.CV_WARN, severity: Severity.WARN },
    { values: [0.2, 0.6], code: IssueCode.CV_FAIL, severity: Severity.ERROR },
  ])('flags $values as $code', ({ values, code, severity }) => {
    const stats = replicateStats(values)
    expect(codesOf(stats.issues)).toEqual([code])
    expect(stats.issues[0]?.severity).toBe(severity)
  })

  it('does not raise the warning alongside the failure', () => {
    const stats = replicateStats([0.1, 0.8])
    expect(hasCode(stats.issues, IssueCode.CV_FAIL)).toBe(true)
    expect(hasCode(stats.issues, IssueCode.CV_WARN)).toBe(false)
  })
})

describe('degenerate input', () => {
  it('reports a single replicate and computes no spread', () => {
    const stats = replicateStats([0.132])
    expect(stats.n).toBe(1)
    expect(stats.mean as number).toBeCloseTo(0.132, 12)
    expect(stats.sd).toBeNull()
    expect(stats.cvPercent).toBeNull()
    expect(codesOf(stats.issues)).toEqual([IssueCode.SINGLE_REPLICATE])
    expect(stats.issues[0]?.severity).toBe(Severity.INFO)
  })

  it.each([[[]], [[null, null, null]]])('reports no data for %j', (values) => {
    const stats = replicateStats(values)
    expect(stats.n).toBe(0)
    expect(stats.mean).toBeNull()
    expect(stats.sd).toBeNull()
    expect(stats.cvPercent).toBeNull()
    expect(codesOf(stats.issues)).toEqual([IssueCode.NO_DATA])
  })

  it('does not divide by a zero mean', () => {
    const stats = replicateStats([0, 0, 0])
    expect(stats.mean).toBe(0)
    expect(stats.sd).toBe(0)
    expect(stats.cvPercent).toBeNull()
    expect(stats.issues).toEqual([])
  })

  it('does not divide by a mean reached from both sides', () => {
    const stats = replicateStats([-0.01, 0.01])
    expect(stats.mean).toBeCloseTo(0, 15)
    expect(stats.cvPercent).toBeNull()
  })

  it('excludes a non-finite replicate and records it', () => {
    const stats = replicateStats([0.5, NaN])
    expect(stats.n).toBe(1)
    expect(codesOf(stats.issues)).toContain(IssueCode.NON_NUMERIC_INPUT)
    expect(stats.issues.find((i) => i.code === IssueCode.NON_NUMERIC_INPUT)?.severity).toBe(
      Severity.WARN,
    )
  })

  it('uses the absolute mean, so a negative mean does not invert the CV', () => {
    const stats = replicateStats([-0.4, -0.6])
    expect(stats.cvPercent as number).toBeGreaterThan(0)
  })
})
