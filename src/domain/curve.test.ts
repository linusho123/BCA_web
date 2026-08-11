import { describe, expect, it } from 'vitest'
import { FitModel } from './constants'
import { correct, fitCurve, inRange, predict, standardLevel } from './curve'
import { CurveNotFittedError, IssueCode, Severity, hasCode } from './errors'
import { isClose } from './linalg'
import {
  EXCEL_COEFFICIENTS,
  REFERENCE_ABSORBANCES,
  REFERENCE_CONCENTRATIONS,
  referenceFit,
  referenceLevels,
} from './reference'

/**
 * Proves features/curve-fitting/standard-curve.feature and
 * features/curve-fitting/curve-quality-guards.feature.
 */

const legacy = referenceFit
const codesOf = (fit: { issues: readonly { code: IssueCode }[] }) => fit.issues.map((i) => i.code)

describe('the workbook fit', () => {
  it('reproduces the four Excel coefficients', () => {
    const fit = legacy()
    expect(fit.fitted).toBe(true)
    fit.coefficients.forEach((c, i) => {
      expect(isClose(c, EXCEL_COEFFICIENTS[i] as number, 1e-9)).toBe(true)
    })
  })

  it.each([
    { absorbance: 0.43, expected: 266.4318544865975 },
    { absorbance: 0.36, expected: 200.68839329745327 },
  ])('predicts $expected at absorbance $absorbance', ({ absorbance, expected }) => {
    expect(isClose(predict(legacy(), absorbance), expected, 1e-9)).toBe(true)
  })

  it('averages replicates per level before fitting', () => {
    const doubled = REFERENCE_CONCENTRATIONS.map((conc, i) => {
      const mean = REFERENCE_ABSORBANCES[i] as number
      return standardLevel(conc, [mean - 0.01, mean + 0.01])
    })
    const fit = fitCurve(doubled, { blankSubtract: false })
    fit.coefficients.forEach((c, i) => {
      expect(isClose(c, legacy().coefficients[i] as number, 1e-9)).toBe(true)
    })
  })

  it('records the calibrated absorbance range', () => {
    const fit = legacy()
    expect(fit.absMin).toBeCloseTo(0.132, 12)
    expect(fit.absMax).toBeCloseTo(2.051, 12)
    expect(inRange(fit, 0.43)).toBe(true)
    expect(inRange(fit, 2.5)).toBe(false)
  })

  it('scores above 0.998 and is monotonic across its range', () => {
    const fit = legacy()
    expect(fit.rSquared as number).toBeGreaterThan(0.998)
    expect(fit.monotonic).toBe(true)
    expect(hasCode(fit.issues, IssueCode.NON_MONOTONIC_CURVE)).toBe(false)
  })

  it('reports no error-severity issue', () => {
    expect(legacy().issues.filter((i) => i.severity === Severity.ERROR)).toEqual([])
  })
})

describe('blank subtraction', () => {
  it('subtracts the blank mean and reports it', () => {
    const fit = fitCurve(referenceLevels(), { blankSubtract: true })
    expect(fit.blankSubtracted).toBe(true)
    expect(fit.blankMeanAbs).toBeCloseTo(0.132, 12)
    expect(correct(fit, 0.43)).toBeCloseTo(0.298, 12)
  })

  it('leaves the predictions unchanged, which is the invariance the two modes rely on', () => {
    // Subtracting a constant from every absorbance reparameterises the cubic — any cubic in
    // (A - b) is also a cubic in A — so with the same shift applied at prediction time the
    // absorbance-to-concentration mapping is identical. The coefficients differ; the answers
    // do not. The failure this guards is shifting the standards but not the samples.
    const subtracted = fitCurve(referenceLevels(), { blankSubtract: true })
    for (const absorbance of [0.36, 0.43, 0.9, 1.5]) {
      expect(isClose(predict(subtracted, absorbance), predict(legacy(), absorbance), 1e-9)).toBe(
        true,
      )
    }
  })

  it('differs from the legacy fit in its coefficients', () => {
    const subtracted = fitCurve(referenceLevels(), { blankSubtract: true })
    expect(subtracted.coefficients).not.toEqual(legacy().coefficients)
  })
})

describe('fit quality reporting', () => {
  it('reports one recovery per level, with none for the blank', () => {
    const fit = legacy()
    expect(fit.recoveries).toHaveLength(REFERENCE_CONCENTRATIONS.length)
    expect(fit.recoveries[0]).toBeNull()
  })

  it('flags the 25 ug/mL standard at about 134 percent and leaves the rest in band', () => {
    const fit = legacy()
    const at25 = fit.recoveries[1] as number
    expect(at25).toBeGreaterThan(130)
    expect(at25).toBeLessThan(140)
    expect(hasCode(fit.issues, IssueCode.RECOVERY_OUT_OF_RANGE)).toBe(true)

    for (const recovery of fit.recoveries.slice(2)) {
      expect(recovery as number).toBeGreaterThanOrEqual(80)
      expect(recovery as number).toBeLessThanOrEqual(120)
    }
    expect(fit.issues.filter((i) => i.code === IssueCode.RECOVERY_OUT_OF_RANGE)).toHaveLength(1)
  })
})

describe('the lower-order models', () => {
  it.each([
    { model: FitModel.INVERSE_QUADRATIC, count: 3, floor: 0.99 },
    { model: FitModel.INVERSE_LINEAR, count: 2, floor: 0.9 },
  ])('fits $model with $count coefficients', ({ model, count, floor }) => {
    const fit = fitCurve(referenceLevels(), { model, blankSubtract: false })
    expect(fit.coefficients).toHaveLength(count)
    expect(fit.rSquared as number).toBeGreaterThan(floor)
  })

  it('fits the working range worse at degree 1 than at degree 3', () => {
    const linear = fitCurve(referenceLevels(), {
      model: FitModel.INVERSE_LINEAR,
      blankSubtract: false,
    })
    expect(linear.rSquared as number).toBeLessThan(legacy().rSquared as number)
  })
})

describe('levels that cannot be used', () => {
  it('drops a level with nothing readable and names it', () => {
    const levels = referenceLevels()
    levels[3] = standardLevel(250, [null, null], 'F')
    const fit = fitCurve(levels, { blankSubtract: false })
    expect(fit.fitted).toBe(true)
    expect(hasCode(fit.issues, IssueCode.LEVEL_DROPPED)).toBe(true)
    expect(fit.levelMeans[3]).toBeNull()
    expect(fit.levelMeans.filter((m) => m !== null)).toHaveLength(8)
    // The slot is kept so recoveries and levels stay index-aligned.
    expect(fit.recoveries).toHaveLength(9)
    expect(fit.recoveries[3]).toBeNull()
  })
})

describe('predicting from a failed fit', () => {
  it('refuses and names the issues that caused the failure', () => {
    const fit = fitCurve([], {})
    expect(fit.fitted).toBe(false)
    expect(() => predict(fit, 0.5)).toThrow(CurveNotFittedError)
    expect(() => predict(fit, 0.5)).toThrow(/INSUFFICIENT_STANDARDS/)
  })

  it('reports out of range rather than throwing for an unfitted curve', () => {
    expect(inRange(fitCurve([], {}), 0.5)).toBe(false)
  })
})

describe('quality guards', () => {
  it.each([
    { levels: 3, model: FitModel.INVERSE_CUBIC },
    { levels: 2, model: FitModel.INVERSE_QUADRATIC },
    { levels: 1, model: FitModel.INVERSE_LINEAR },
  ])('refuses $model with only $levels levels', ({ levels, model }) => {
    const fit = fitCurve(referenceLevels().slice(0, levels), { model, blankSubtract: false })
    expect(codesOf(fit)).toContain(IssueCode.INSUFFICIENT_STANDARDS)
    expect(fit.coefficients).toHaveLength(0)
  })

  it('refuses standards whose absorbances are all equal', () => {
    const levels = [100, 200, 300, 400, 500].map((c) => standardLevel(c, [0.5]))
    const fit = fitCurve(levels, { blankSubtract: false })
    expect(codesOf(fit)).toContain(IssueCode.SINGULAR_DESIGN)
    expect(fit.coefficients).toHaveLength(0)
  })

  it('refuses an empty level list', () => {
    const fit = fitCurve([])
    expect(codesOf(fit)).toContain(IssueCode.INSUFFICIENT_STANDARDS)
    expect(fit.coefficients).toHaveLength(0)
  })

  it('refuses a negative standard concentration', () => {
    const levels = [...referenceLevels(), standardLevel(-100, [0.2])]
    const fit = fitCurve(levels, { blankSubtract: false })
    expect(codesOf(fit)).toContain(IssueCode.NEGATIVE_CONCENTRATION)
    expect(fit.coefficients).toHaveLength(0)
  })

  it('warns and fits unsubtracted when a blank was asked for but is absent', () => {
    const fit = fitCurve(referenceLevels().slice(1), { blankSubtract: true })
    expect(codesOf(fit)).toContain(IssueCode.NO_BLANK_STANDARD)
    expect(fit.blankSubtracted).toBe(false)
    expect(fit.fitted).toBe(true)
  })

  it('warns about a duplicated concentration and still fits', () => {
    const levels = [...referenceLevels(), standardLevel(500, [0.64])]
    const fit = fitCurve(levels, { blankSubtract: false })
    expect(codesOf(fit)).toContain(IssueCode.DUPLICATE_STANDARD_CONC)
    expect(fit.fitted).toBe(true)
  })

  it('flags a curve that reverses direction inside its range', () => {
    const scrambled = [
      standardLevel(0, [0.132]),
      standardLevel(25, [1.9]),
      standardLevel(125, [0.3]),
      standardLevel(250, [1.6]),
      standardLevel(500, [0.5]),
      standardLevel(1000, [1.2]),
    ]
    const fit = fitCurve(scrambled, { blankSubtract: false })
    expect(fit.monotonic).toBe(false)
    expect(codesOf(fit)).toContain(IssueCode.NON_MONOTONIC_CURVE)
  })

  it('flags a poor fit and still returns coefficients', () => {
    const noisy = [
      standardLevel(0, [0.13]),
      standardLevel(250, [1.4]),
      standardLevel(500, [0.4]),
      standardLevel(1000, [1.1]),
      standardLevel(2000, [1.2]),
    ]
    const fit = fitCurve(noisy, { blankSubtract: false })
    expect(fit.rSquared as number).toBeLessThan(0.99)
    expect(codesOf(fit)).toContain(IssueCode.POOR_FIT)
    expect(fit.fitted).toBe(true)
  })

  it('flags a high blank as possible reagent contamination', () => {
    const levels = referenceLevels()
    levels[0] = standardLevel(0, [0.35], 'I')
    const fit = fitCurve(levels, { blankSubtract: true })
    expect(codesOf(fit)).toContain(IssueCode.HIGH_BLANK)
  })
})
