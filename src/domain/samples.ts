/**
 * Unknown back-calculation: what each sample's absorbance says its concentration is.
 *
 * Ported from BCA_quarto `src/bca/samples.py` (specdoc §3.3).
 *
 * Implements workbook columns F, G and I.
 *
 * This file used to carry the SDS-PAGE loading plan as well — columns J, K and L, which turned a
 * concentration into pipetting volumes for a gel lane. It was removed on 2026-08-12 as
 * unnecessary to the assay this app is for. `concUgPerUL` stays: it is workbook column I and a
 * result in its own right, not a leftover of the loading arithmetic that consumed it.
 */

import { type Issue, IssueCode, Severity, issue } from './errors'
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
