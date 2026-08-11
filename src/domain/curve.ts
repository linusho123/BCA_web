/**
 * Standard curve fitting.
 *
 * Ported from BCA_quarto `src/bca/curve.py` (specdoc §3.2, §3.4, §3.6, §6.4).
 *
 * Reproduces the workbook's LINEST(conc, abs^{1,2,3}), which regresses **concentration on
 * absorbance** — an inverse calibration. That is statistically unorthodox: classical
 * calibration regresses response on concentration and inverts. It is nonetheless what this lab
 * has always used and what every historical result was computed with, so it is reproduced
 * exactly and named `inverse_cubic` so that nobody mistakes it for a classical fit.
 *
 * Added on top of the workbook, none of which it has: R squared, per-standard recovery, a
 * monotonicity check, and blank handling per the Pierce manual's steps 5 and 6.
 */

import {
  BLANK_ABSORBANCE_WARN,
  FitModel,
  MONOTONIC_SAMPLES,
  POOR_FIT_R_SQUARED,
  RECOVERY_HIGH_PERCENT,
  RECOVERY_LOW_PERCENT,
  modelDegree,
  modelLabel,
} from './constants'
import {
  CurveNotFittedError,
  type Issue,
  IssueCode,
  Severity,
  SingularMatrixError,
  hasErrors,
  issue,
} from './errors'
import { fixed, num } from './format'
import { fsum, polyfit, polyval, rSquared } from './linalg'
import { type Replicate, replicateStats } from './qc'

export interface StandardLevel {
  readonly concUgPerML: number
  readonly replicates: readonly Replicate[]
  /** The vial letter the researcher labelled this level with, for display. */
  readonly tubeId: string | null
}

export function standardLevel(
  concUgPerML: number,
  replicates: readonly Replicate[],
  tubeId: string | null = null,
): StandardLevel {
  return { concUgPerML, replicates, tubeId }
}

const isBlankLevel = (level: StandardLevel): boolean => level.concUgPerML === 0

export interface CurveFit {
  readonly model: FitModel
  /** Highest power first. Empty when the fit failed — check `fitted`. */
  readonly coefficients: readonly number[]
  readonly fitted: boolean
  readonly rSquared: number | null
  /** Bounds in the space the fit works in: blank-corrected when subtraction was applied. */
  readonly absMin: number | null
  readonly absMax: number | null
  readonly concMin: number | null
  readonly concMax: number | null
  /** Whether the blank was actually taken off the standards before fitting. */
  readonly blankSubtracted: boolean
  /**
   * The mean of the 0 µg/mL standard, if the plate carried one — measured, not necessarily
   * applied.
   *
   * These two are separate on purpose. The blank is a reading in its own right: it is what tells
   * a sample it is darker than water and what says the reagent may be contaminated. Both of those
   * are true whether or not the fit chose to subtract it, and the legacy mode that does not
   * subtract is exactly the mode in which a sample below the blank most needs pointing out.
   */
  readonly blankMeanAbs: number | null
  readonly levels: readonly StandardLevel[]
  /** One slot per input level; null where the level was dropped. Always aligns with `levels`. */
  readonly levelMeans: ReadonlyArray<number | null>
  /** One slot per input level; null for the blank and for any dropped level. */
  readonly recoveries: ReadonlyArray<number | null>
  readonly monotonic: boolean
  readonly issues: readonly Issue[]
}

export interface FitCurveOptions {
  model?: FitModel
  blankSubtract?: boolean
}

/** Apply the same blank correction the standards received. */
export function correct(fit: CurveFit, absorbance: number): number {
  if (fit.blankSubtracted && fit.blankMeanAbs !== null) return absorbance - fit.blankMeanAbs
  return absorbance
}

/** Concentration in µg/mL for a raw absorbance. Throws only if the fit has no coefficients. */
export function predict(fit: CurveFit, absorbance: number): number {
  if (fit.coefficients.length === 0) {
    const reasons = fit.issues.map((i) => i.code).join(', ')
    throw new CurveNotFittedError(
      `curve has no coefficients${reasons ? `; issues: ${reasons}` : ''}`,
    )
  }
  return polyval(fit.coefficients, correct(fit, absorbance))
}

/** Whether a raw absorbance falls inside the calibrated span. */
export function inRange(fit: CurveFit, absorbance: number): boolean {
  if (fit.absMin === null || fit.absMax === null) return false
  const corrected = correct(fit, absorbance)
  return fit.absMin <= corrected && corrected <= fit.absMax
}

function emptyFit(
  model: FitModel,
  levels: readonly StandardLevel[],
  issues: readonly Issue[],
  appliedBlank: number | null,
  measuredBlank: number | null,
  levelMeans?: ReadonlyArray<number | null>,
): CurveFit {
  return {
    model,
    coefficients: [],
    fitted: false,
    rSquared: null,
    absMin: null,
    absMax: null,
    concMin: null,
    concMax: null,
    blankSubtracted: appliedBlank !== null,
    blankMeanAbs: measuredBlank,
    levels,
    levelMeans: levelMeans ?? levels.map(() => null),
    recoveries: levels.map(() => null),
    monotonic: false,
    issues,
  }
}

/**
 * Whether the fitted curve keeps one direction across the calibrated span.
 *
 * A cubic fitted to noisy standards can double back inside the working range, which makes
 * back-calculation ambiguous: two absorbances map to the same concentration and there is no
 * principled way to choose. The legacy sheet is silently wrong in exactly that case.
 */
function isMonotonic(coefficients: readonly number[], lo: number, hi: number): boolean {
  if (hi <= lo) return true
  const step = (hi - lo) / MONOTONIC_SAMPLES
  let previous = polyval(coefficients, lo)
  let direction = 0
  for (let i = 1; i <= MONOTONIC_SAMPLES; i++) {
    const current = polyval(coefficients, lo + i * step)
    const delta = current - previous
    if (delta !== 0) {
      const sign = delta > 0 ? 1 : -1
      if (direction === 0) direction = sign
      else if (sign !== direction) return false
    }
    previous = current
  }
  return true
}

/** Fit concentration as a function of absorbance across the BSA standards. Never throws. */
export function fitCurve(
  levels: readonly StandardLevel[],
  options: FitCurveOptions = {},
): CurveFit {
  const { model = FitModel.INVERSE_CUBIC, blankSubtract = true } = options
  const issues: Issue[] = []

  if (levels.length === 0) {
    issues.push(
      issue(
        IssueCode.INSUFFICIENT_STANDARDS,
        Severity.ERROR,
        'no standard levels were supplied',
        'levels',
      ),
    )
    return emptyFit(model, levels, issues, null, null)
  }

  for (const level of levels) {
    if (level.concUgPerML < 0) {
      issues.push(
        issue(
          IssueCode.NEGATIVE_CONCENTRATION,
          Severity.ERROR,
          `standard ${level.tubeId ?? num(level.concUgPerML)} has a negative concentration`,
          level.tubeId,
        ),
      )
    }
  }

  // Mean each level's replicates, dropping levels with nothing usable. `levelMeans` keeps one
  // slot per input level — null where a level was dropped — so it always aligns with `levels`
  // and callers can zip the two without tracking which rows survived.
  const levelMeans: Array<number | null> = []
  const usable: Array<{ index: number; level: StandardLevel; mean: number }> = []

  levels.forEach((level, index) => {
    const label = level.tubeId ?? `${num(level.concUgPerML)} ug/mL`
    const stats = replicateStats(level.replicates, label)
    // NO_DATA is folded into LEVEL_DROPPED below; reporting both would say the same thing twice.
    for (const i of stats.issues) if (i.code !== IssueCode.NO_DATA) issues.push(i)
    levelMeans.push(stats.mean)
    if (stats.mean === null) {
      issues.push(
        issue(
          IssueCode.LEVEL_DROPPED,
          Severity.WARN,
          `standard ${label} has no usable replicates and was excluded from the fit`,
          label,
        ),
      )
      return
    }
    usable.push({ index, level, mean: stats.mean })
  })

  const seenConc = new Set<number>()
  for (const entry of usable) {
    if (seenConc.has(entry.level.concUgPerML)) {
      issues.push(
        issue(
          IssueCode.DUPLICATE_STANDARD_CONC,
          Severity.WARN,
          `more than one standard is at ${num(entry.level.concUgPerML)} ug/mL`,
          entry.level.tubeId,
        ),
      )
    }
    seenConc.add(entry.level.concUgPerML)
  }

  // Blank handling (specdoc §3.4): the manual subtracts it, the legacy sheet does not.
  let blankMean: number | null = null
  const blanks = usable.filter((e) => isBlankLevel(e.level)).map((e) => e.mean)
  if (blanks.length > 0) {
    blankMean = fsum(blanks) / blanks.length
    if (blankMean > BLANK_ABSORBANCE_WARN) {
      issues.push(
        issue(
          IssueCode.HIGH_BLANK,
          Severity.WARN,
          `mean blank absorbance is ${fixed(blankMean, 3)}, above the ${BLANK_ABSORBANCE_WARN} ` +
            'guideline; check for reagent contamination',
          'blank',
          { blank: fixed(blankMean, 4) },
        ),
      )
    }
  } else if (blankSubtract) {
    issues.push(
      issue(
        IssueCode.NO_BLANK_STANDARD,
        Severity.WARN,
        'blank subtraction was requested but no 0 ug/mL standard is present; ' +
          'fitting raw absorbances instead',
        'levels',
      ),
    )
  }

  const appliedBlank = blankSubtract && blankMean !== null ? blankMean : null
  const offset = appliedBlank ?? 0

  const absorbances = usable.map((e) => e.mean - offset)
  const concentrations = usable.map((e) => e.level.concUgPerML)
  const degree = modelDegree(model)

  if (usable.length < degree + 1) {
    issues.push(
      issue(
        IssueCode.INSUFFICIENT_STANDARDS,
        Severity.ERROR,
        `a ${modelLabel(model).toLowerCase()} fit needs at least ${degree + 1} standards, ` +
          `got ${usable.length}`,
        'levels',
        { required: degree + 1, available: usable.length },
      ),
    )
    return emptyFit(model, levels, issues, appliedBlank, blankMean, levelMeans)
  }

  if (hasErrors(issues)) return emptyFit(model, levels, issues, appliedBlank, blankMean, levelMeans)

  let coefficients: number[]
  try {
    coefficients = polyfit(absorbances, concentrations, degree)
  } catch (exc) {
    if (exc instanceof SingularMatrixError) {
      issues.push(
        issue(
          IssueCode.SINGULAR_DESIGN,
          Severity.ERROR,
          `the standard curve could not be fitted: ${exc.message}`,
          'levels',
        ),
      )
      return emptyFit(model, levels, issues, appliedBlank, blankMean, levelMeans)
    }
    throw exc
  }

  const score = rSquared(absorbances, concentrations, coefficients)
  if (score < POOR_FIT_R_SQUARED) {
    issues.push(
      issue(
        IssueCode.POOR_FIT,
        Severity.WARN,
        `R-squared is ${fixed(score, 4)}, below the ${POOR_FIT_R_SQUARED} guideline`,
        'fit',
        { rSquared: fixed(score, 6) },
      ),
    )
  }

  // One recovery per input level, null for the blank — 0/0 is undefined — and for any level
  // that was dropped, so `recoveries[i]` always describes `levels[i]`.
  const recoveries: Array<number | null> = levels.map(() => null)
  usable.forEach((entry, k) => {
    if (entry.level.concUgPerML === 0) return
    const predicted = polyval(coefficients, absorbances[k] as number)
    const recovery = (100 * predicted) / entry.level.concUgPerML
    recoveries[entry.index] = recovery
    if (!(recovery >= RECOVERY_LOW_PERCENT && recovery <= RECOVERY_HIGH_PERCENT)) {
      const label = entry.level.tubeId ?? `${num(entry.level.concUgPerML)} ug/mL`
      issues.push(
        issue(
          IssueCode.RECOVERY_OUT_OF_RANGE,
          Severity.WARN,
          `standard ${label} back-calculates to ${fixed(recovery, 1)}% of its nominal value, ` +
            `outside ${RECOVERY_LOW_PERCENT}-${RECOVERY_HIGH_PERCENT}%`,
          entry.level.tubeId ?? label,
          { recovery: fixed(recovery, 2) },
        ),
      )
    }
  })

  const absMin = Math.min(...absorbances)
  const absMax = Math.max(...absorbances)
  const monotonic = isMonotonic(coefficients, absMin, absMax)
  if (!monotonic) {
    issues.push(
      issue(
        IssueCode.NON_MONOTONIC_CURVE,
        Severity.WARN,
        'the fitted curve reverses direction inside the calibrated range, so back-calculation ' +
          'is ambiguous; consider a lower-degree model',
        'fit',
      ),
    )
  }

  return {
    model,
    coefficients,
    fitted: true,
    rSquared: score,
    absMin,
    absMax,
    concMin: Math.min(...concentrations),
    concMax: Math.max(...concentrations),
    blankSubtracted: appliedBlank !== null,
    blankMeanAbs: blankMean,
    levels,
    levelMeans,
    recoveries,
    monotonic,
    issues,
  }
}
