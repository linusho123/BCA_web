/**
 * Unknown back-calculation and the SDS-PAGE loading plan.
 *
 * Ported from BCA_quarto `src/bca/samples.py` (specdoc §3.3, §6.5).
 *
 * Implements workbook columns F, G and I (concentrations) and J, K and L (loading volumes).
 *
 * The loading calculation is where the workbook's worst defect lives. For the reference data it
 * prints `K29 = -750.66` µL of diluent, in the same font as every real volume beside it. A
 * negative diluent volume is physically impossible; what it means is that the sample is too
 * dilute to deliver the requested mass in the requested volume, and the three ways out are to
 * concentrate the sample, lower the target mass, or raise the final volume.
 *
 * DEVIATION FROM THE SOURCE PROJECT: BCA_quarto returns the negative number alongside the
 * error, on the reasoning that the issue makes it safe. It is not returned here — an infeasible
 * row reports its diluent as absent. The error is attached to a row in a table a researcher may
 * print and carry to the bench, and a negative number in a volume column is one glance away
 * from being read as a volume however loudly the panel above it complains.
 */

import { MIN_PROTEIN_PIPETTABLE_UL } from './constants'
import { type Issue, IssueCode, Severity, hasErrors, issue } from './errors'
import { fixed, num } from './format'
import { type CurveFit, correct, inRange, predict } from './curve'
import { type Replicate, replicateStats } from './qc'

export interface SampleInput {
  readonly name: string
  readonly replicates: readonly Replicate[]
}

export interface SampleResult {
  readonly name: string
  readonly replicates: readonly Replicate[]
  readonly n: number
  readonly meanAbs: number | null
  readonly sdAbs: number | null
  readonly cvPercent: number | null
  /** In the well as read. Null when there was nothing to read or no curve to read it against. */
  readonly concUgPerML: number | null
  /** In the original stock, i.e. after the dilution factor is undone. */
  readonly concUgPerUL: number | null
  readonly dilutionFactor: number
  readonly extrapolated: boolean
  readonly issues: readonly Issue[]
}

export interface AnalyseSamplesOptions {
  dilutionFactor?: number
}

/**
 * Back-calculate concentrations for unknown samples.
 *
 *   meanAbs      = mean(replicates)               (workbook F29)
 *   concUgPerML  = predict(fit, meanAbs)          (workbook G29)
 *   concUgPerUL  = concUgPerML / 1000 * DF        (workbook I29)
 *
 * A sample with no usable replicates is reported with absent values rather than dropped, so a
 * row a researcher expected to see never silently vanishes from the table.
 */
export function analyseSamples(
  fit: CurveFit,
  samples: readonly SampleInput[],
  options: AnalyseSamplesOptions = {},
): SampleResult[] {
  const { dilutionFactor = 1 } = options

  const shared: Issue[] = []
  if (dilutionFactor <= 0) {
    shared.push(
      issue(
        IssueCode.DILUTION_FACTOR_INVALID,
        Severity.ERROR,
        `dilution factor must be greater than 0, got ${num(dilutionFactor)}`,
        'dilutionFactor',
      ),
    )
  }
  if (!fit.fitted) {
    shared.push(
      issue(
        IssueCode.CURVE_UNAVAILABLE,
        Severity.ERROR,
        'the standard curve did not fit, so concentrations cannot be calculated',
        'curve',
      ),
    )
  }

  return samples.map((sample) => {
    const stats = replicateStats(sample.replicates, sample.name)
    const rowIssues = [...shared, ...stats.issues]

    if (stats.mean === null || !fit.fitted || dilutionFactor <= 0) {
      return {
        name: sample.name,
        replicates: sample.replicates,
        n: stats.n,
        meanAbs: stats.mean,
        sdAbs: stats.sd,
        cvPercent: stats.cvPercent,
        concUgPerML: null,
        concUgPerUL: null,
        dilutionFactor,
        extrapolated: false,
        issues: rowIssues,
      }
    }

    const meanAbs = stats.mean
    const concUgPerML = predict(fit, meanAbs)
    const concUgPerUL = (concUgPerML / 1000) * dilutionFactor

    const extrapolated = !inRange(fit, meanAbs)
    if (extrapolated) {
      const bound = correct(fit, meanAbs) > (fit.absMax ?? 0) ? 'above' : 'below'
      rowIssues.push(
        issue(
          IssueCode.EXTRAPOLATED,
          Severity.WARN,
          `absorbance ${fixed(meanAbs, 3)} lies ${bound} the calibrated range ` +
            `(${fixed(fit.absMin ?? 0, 3)}-${fixed(fit.absMax ?? 0, 3)} corrected); the fit is ` +
            'extrapolating and diverges quickly outside the standards',
          sample.name,
          { absorbance: fixed(meanAbs, 4) },
        ),
      )
    }

    if (fit.blankMeanAbs !== null && meanAbs < fit.blankMeanAbs) {
      rowIssues.push(
        issue(
          IssueCode.BELOW_BLANK,
          Severity.WARN,
          `absorbance ${fixed(meanAbs, 3)} is below the blank (${fixed(fit.blankMeanAbs, 3)}); ` +
            'this sample reads as having no protein',
          sample.name,
        ),
      )
    }

    if (concUgPerML < 0) {
      rowIssues.push(
        issue(
          IssueCode.NEGATIVE_CONCENTRATION_RESULT,
          Severity.WARN,
          `the curve returns a negative concentration (${fixed(concUgPerML, 2)} ug/mL) for ` +
            'this absorbance',
          sample.name,
        ),
      )
    }

    return {
      name: sample.name,
      replicates: sample.replicates,
      n: stats.n,
      meanAbs,
      sdAbs: stats.sd,
      cvPercent: stats.cvPercent,
      concUgPerML,
      concUgPerUL,
      dilutionFactor,
      extrapolated,
      issues: rowIssues,
    }
  })
}

export interface LoadingRow {
  readonly name: string
  readonly concUgPerUL: number | null
  readonly proteinUL: number | null
  /** Absent rather than negative when the lane does not fit — see the module header. */
  readonly diluentUL: number | null
  readonly dyeUL: number
  readonly finalVolumeUL: number
  readonly feasible: boolean
  readonly issues: readonly Issue[]
}

export interface LoadingPlanOptions {
  desiredProteinUg: number
  finalVolumeUL: number
  includeDye?: boolean
  dyeFraction?: number
}

/**
 * Compute SDS-PAGE loading volumes.
 *
 *   proteinUL = desiredProteinUg / concUgPerUL       (workbook J29)
 *   dyeUL     = finalVolumeUL * dyeFraction          (workbook L29 = M26/4)
 *   diluentUL = finalVolumeUL - proteinUL - dyeUL    (workbook K29)
 *
 * Without dye — the workbook's second table, rows 56 to 80 — the dye term drops out of both.
 */
export function buildLoadingPlan(
  results: readonly SampleResult[],
  options: LoadingPlanOptions,
): LoadingRow[] {
  const { desiredProteinUg, finalVolumeUL, includeDye = true, dyeFraction = 0.25 } = options

  const shared: Issue[] = []
  if (desiredProteinUg <= 0) {
    shared.push(
      issue(
        IssueCode.NON_POSITIVE_VOLUME,
        Severity.ERROR,
        `desired protein amount must be greater than 0, got ${num(desiredProteinUg)}`,
        'desiredProteinUg',
      ),
    )
  }
  if (finalVolumeUL <= 0) {
    shared.push(
      issue(
        IssueCode.NON_POSITIVE_VOLUME,
        Severity.ERROR,
        `final volume must be greater than 0, got ${num(finalVolumeUL)}`,
        'finalVolumeUL',
      ),
    )
  }
  if (includeDye && !(dyeFraction >= 0 && dyeFraction < 1)) {
    shared.push(
      issue(
        IssueCode.DYE_FRACTION_INVALID,
        Severity.ERROR,
        `dye fraction must be at least 0 and below 1, got ${num(dyeFraction)}`,
        'dyeFraction',
      ),
    )
  }

  const fatal = hasErrors(shared)
  const dyeUL = includeDye && !fatal ? finalVolumeUL * dyeFraction : 0

  return results.map((result): LoadingRow => {
    const rowIssues = [...shared]
    const conc = result.concUgPerUL
    const base = { name: result.name, dyeUL, finalVolumeUL, feasible: false } as const

    if (conc === null) {
      rowIssues.push(
        issue(
          IssueCode.NO_DATA,
          Severity.INFO,
          'no concentration available for this sample, so no loading volumes could be computed',
          result.name,
        ),
      )
      // The issues that left it without a concentration travel with the row, so the loading
      // table explains itself without the reader cross-referencing the samples table.
      return { ...base, concUgPerUL: null, proteinUL: null, diluentUL: null, issues: [...rowIssues, ...result.issues] }
    }

    if (conc <= 0) {
      rowIssues.push(
        issue(
          IssueCode.ZERO_CONCENTRATION_DIVISION,
          Severity.ERROR,
          `sample concentration is ${fixed(conc, 4)} ug/uL; a non-positive concentration ` +
            'cannot deliver a protein mass',
          result.name,
        ),
      )
      return { ...base, concUgPerUL: conc, proteinUL: null, diluentUL: null, issues: rowIssues }
    }

    if (fatal) {
      return { ...base, concUgPerUL: conc, proteinUL: null, diluentUL: null, issues: rowIssues }
    }

    const proteinUL = desiredProteinUg / conc
    const required = proteinUL + dyeUL
    // The tolerance is what makes "exactly full" feasible: 22.5 + 7.5 is not always exactly 30.
    const feasible = required <= finalVolumeUL || Math.abs(required - finalVolumeUL) <= 1e-9

    if (!feasible) {
      rowIssues.push(
        issue(
          IssueCode.INSUFFICIENT_VOLUME,
          Severity.ERROR,
          `delivering ${num(desiredProteinUg)} ug needs ${fixed(proteinUL, 1)} uL of sample ` +
            `plus ${fixed(dyeUL, 1)} uL of dye (${fixed(required, 1)} uL), which exceeds the ` +
            `${num(finalVolumeUL)} uL final volume. Concentrate the sample, lower the target ` +
            'mass, or raise the final volume.',
          result.name,
          { availableUL: fixed(finalVolumeUL, 2), requiredUL: fixed(required, 2) },
        ),
      )
      // proteinUL is kept because it is the actionable number — it says how far off the lane
      // is — while diluentUL, which would be negative, is not.
      return { ...base, concUgPerUL: conc, proteinUL, diluentUL: null, issues: rowIssues }
    }

    if (proteinUL < MIN_PROTEIN_PIPETTABLE_UL) {
      rowIssues.push(
        issue(
          IssueCode.PROTEIN_VOLUME_UNPIPETTABLE,
          Severity.WARN,
          `only ${fixed(proteinUL, 3)} uL of sample is needed, below the ` +
            `${MIN_PROTEIN_PIPETTABLE_UL} uL reliable minimum; dilute the sample or load ` +
            'more protein',
          result.name,
          { volume: fixed(proteinUL, 4) },
        ),
      )
    }

    return {
      name: result.name,
      concUgPerUL: conc,
      proteinUL,
      diluentUL: finalVolumeUL - proteinUL - dyeUL,
      dyeUL,
      finalVolumeUL,
      feasible: true,
      issues: rowIssues,
    }
  })
}
