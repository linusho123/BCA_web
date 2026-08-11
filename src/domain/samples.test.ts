import { describe, expect, it } from 'vitest'
import { fitCurve, standardLevel } from './curve'
import { IssueCode, Severity, hasCode } from './errors'
import { isClose } from './linalg'
import { referenceFit, referenceLevels, REFERENCE_SAMPLES } from './reference'
import { analyseSamples, buildLoadingPlan, type SampleInput } from './samples'

/**
 * Proves features/samples/sample-back-calculation.feature and
 * features/samples/loading-plan.feature.
 */

const one = (name: string, absorbance: number): SampleInput => ({ name, replicates: [absorbance] })
const codesOf = (issues: readonly { code: IssueCode }[]) => issues.map((i) => i.code)

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

// --- loading plan ----------------------------------------------------------

const resultAt = (name: string, concUgPerUL: number | null) => ({
  name,
  replicates: [] as (number | null)[],
  n: 0,
  meanAbs: null,
  sdAbs: null,
  cvPercent: null,
  concUgPerML: concUgPerUL === null ? null : concUgPerUL * 1000,
  concUgPerUL,
  dilutionFactor: 1,
  extrapolated: false,
  issues: [],
})

describe('the workbook loading table', () => {
  it.each(REFERENCE_SAMPLES)('reproduces $name protein volume to 1e-9', (golden) => {
    const [row] = buildLoadingPlan([resultAt(golden.name, golden.concUgPerUL)], {
      desiredProteinUg: 400,
      finalVolumeUL: 1000,
    })
    expect(isClose(row?.proteinUL as number, golden.proteinUL, 1e-9)).toBe(true)
  })

  it('sums a feasible lane to the final volume', () => {
    const [row] = buildLoadingPlan([resultAt('Lysate', 2)], {
      desiredProteinUg: 10,
      finalVolumeUL: 30,
    })
    expect(row?.proteinUL).toBeCloseTo(5, 12)
    expect(row?.diluentUL).toBeCloseTo(17.5, 12)
    expect(row?.dyeUL).toBeCloseTo(7.5, 12)
    expect((row?.proteinUL as number) + (row?.diluentUL as number) + (row?.dyeUL as number)).
      toBeCloseTo(30, 12)
    expect(row?.issues).toEqual([])
  })

  it.each([
    { volume: 40, fraction: 0.25, dye: 10 },
    { volume: 25, fraction: 0.2, dye: 5 },
    { volume: 30, fraction: 0.25, dye: 7.5 },
  ])('makes dye $dye uL of a $volume uL lane at $fraction', ({ volume, fraction, dye }) => {
    const [row] = buildLoadingPlan([resultAt('Lysate', 2)], {
      desiredProteinUg: 10,
      finalVolumeUL: volume,
      dyeFraction: fraction,
    })
    expect(row?.dyeUL).toBeCloseTo(dye, 12)
  })

  it('fills the whole lane with diluent when dye is off', () => {
    const [row] = buildLoadingPlan([resultAt('Lysate', 2)], {
      desiredProteinUg: 10,
      finalVolumeUL: 30,
      includeDye: false,
    })
    expect(row?.dyeUL).toBe(0)
    expect(row?.diluentUL).toBeCloseTo(25, 12)
  })

  it('treats an exactly full lane as feasible with no diluent', () => {
    const [row] = buildLoadingPlan([resultAt('Lysate', 2)], {
      desiredProteinUg: 45,
      finalVolumeUL: 30,
    })
    expect(row?.feasible).toBe(true)
    expect(row?.proteinUL).toBeCloseTo(22.5, 12)
    expect(row?.diluentUL).toBeCloseTo(0, 12)
    expect(row?.issues).toEqual([])
  })

  it('preserves order and names', () => {
    const names = ['delta', 'alpha', 'charlie', 'bravo']
    const rows = buildLoadingPlan(
      names.map((n) => resultAt(n, 2)),
      { desiredProteinUg: 10, finalVolumeUL: 30 },
    )
    expect(rows.map((r) => r.name)).toEqual(names)
  })
})

describe('the negative diluent defect', () => {
  it('refuses the workbook lane and states the numbers that explain it', () => {
    const [row] = buildLoadingPlan([resultAt('MCF7', 0.532863708973195)], {
      desiredProteinUg: 400,
      finalVolumeUL: 30,
    })
    expect(row?.feasible).toBe(false)
    expect(hasCode(row?.issues ?? [], IssueCode.INSUFFICIENT_VOLUME)).toBe(true)
    expect(row?.diluentUL).toBeNull()

    const context = Object.fromEntries(
      row?.issues.find((i) => i.code === IssueCode.INSUFFICIENT_VOLUME)?.context ?? [],
    )
    expect(context['requiredUL']).toBe('758.16')
    expect(context['availableUL']).toBe('30.00')
    // The actionable number survives: it is how far off the lane is.
    expect(row?.proteinUL).toBeCloseTo(750.6609912894659, 9)
  })

  it('refuses the sheet’s literal blank final volume', () => {
    const [row] = buildLoadingPlan([resultAt('MCF7', 0.532863708973195)], {
      desiredProteinUg: 400,
      finalVolumeUL: 0,
    })
    expect(codesOf(row?.issues ?? [])).toContain(IssueCode.NON_POSITIVE_VOLUME)
    expect(row?.diluentUL).toBeNull()
    expect(row?.feasible).toBe(false)
  })
})

describe('loading guards', () => {
  it.each([0, -0.5])('refuses a concentration of %s rather than dividing by it', (conc) => {
    const [row] = buildLoadingPlan([resultAt('Odd', conc)], {
      desiredProteinUg: 10,
      finalVolumeUL: 30,
    })
    expect(codesOf(row?.issues ?? [])).toContain(IssueCode.ZERO_CONCENTRATION_DIVISION)
    expect(row?.proteinUL).toBeNull()
  })

  it.each([
    { mass: 0, volume: 30, fraction: 0.25, code: IssueCode.NON_POSITIVE_VOLUME },
    { mass: -10, volume: 30, fraction: 0.25, code: IssueCode.NON_POSITIVE_VOLUME },
    { mass: 10, volume: -5, fraction: 0.25, code: IssueCode.NON_POSITIVE_VOLUME },
    { mass: 10, volume: 30, fraction: 1.5, code: IssueCode.DYE_FRACTION_INVALID },
  ])('refuses mass $mass, volume $volume, dye $fraction', ({ mass, volume, fraction, code }) => {
    const [row] = buildLoadingPlan([resultAt('Lysate', 2)], {
      desiredProteinUg: mass,
      finalVolumeUL: volume,
      dyeFraction: fraction,
    })
    expect(codesOf(row?.issues ?? [])).toContain(code)
  })

  it('flags a protein volume below half a microlitre', () => {
    const [row] = buildLoadingPlan([resultAt('Concentrated', 100)], {
      desiredProteinUg: 10,
      finalVolumeUL: 30,
    })
    expect(row?.proteinUL).toBeCloseTo(0.1, 12)
    expect(codesOf(row?.issues ?? [])).toContain(IssueCode.PROTEIN_VOLUME_UNPIPETTABLE)
  })

  it('emits a row of absences for a sample with no concentration', () => {
    const upstream = analyseSamples(referenceFit(), [{ name: 'Ghost', replicates: [null] }])
    const [row] = buildLoadingPlan(upstream, { desiredProteinUg: 10, finalVolumeUL: 30 })
    expect(row?.name).toBe('Ghost')
    expect(row?.proteinUL).toBeNull()
    expect(row?.diluentUL).toBeNull()
    // The upstream reason travels with the row so the table explains itself.
    expect(codesOf(row?.issues ?? [])).toContain(IssueCode.NO_DATA)
  })
})
