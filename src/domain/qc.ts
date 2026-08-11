/**
 * Replicate statistics and their quality flags.
 *
 * Ported from BCA_quarto `src/bca/qc.py` (specdoc §3.5).
 *
 * The reference workbook computes AVERAGE and nothing else, so a replicate pair differing by
 * 30% is indistinguishable from a tight one and both means are reported with the same
 * confidence. This module is the spread the workbook never showed.
 *
 * Every threshold is exclusive at its boundary: a CV of exactly 15% does not warn. A rule that
 * fires at its own printed boundary makes the printed number wrong by one increment, and this
 * is the kind of detail a researcher checks once and then trusts forever.
 */

import { CV_FAIL_PERCENT, CV_WARN_PERCENT } from './constants'
import { fixed } from './format'
import { type Issue, IssueCode, Severity, issue } from './errors'
import { fsum, ipow } from './linalg'

export interface ReplicateStats {
  /** The values actually used, after empty and non-finite entries were dropped. */
  readonly values: readonly number[]
  readonly n: number
  readonly mean: number | null
  /** Sample standard deviation. Absent for n < 2. */
  readonly sd: number | null
  /** Absent when the mean is zero — there is no scale to express spread against. */
  readonly cvPercent: number | null
  readonly issues: readonly Issue[]
}

/** A replicate reading: a number, or empty because the well was unreadable. */
export type Replicate = number | null

/**
 * Drop empty and non-finite entries, reporting any that were discarded.
 *
 * A non-finite value here means a cell parsed to NaN somewhere upstream. Excluding it silently
 * would make a two-replicate row report as a one-replicate row with no explanation.
 */
export function cleanReplicates(
  values: readonly Replicate[],
  field?: string,
): { kept: number[]; issues: Issue[] } {
  const issues: Issue[] = []
  const kept: number[] = []
  values.forEach((value, index) => {
    if (value === null) return
    if (!Number.isFinite(value)) {
      issues.push(
        issue(
          IssueCode.NON_NUMERIC_INPUT,
          Severity.WARN,
          `replicate ${index + 1} is not a finite number and was excluded`,
          field,
          { index },
        ),
      )
      return
    }
    kept.push(value)
  })
  return { kept, issues }
}

/**
 * Mean, sample standard deviation and CV% over technical replicates.
 *
 * Nothing here throws and nothing divides by zero. An empty row, a single reading and
 * replicates that are all zero each return absences rather than NaN, so the table renders a
 * blank cell instead of the string "NaN" — which is what a researcher would otherwise have to
 * learn to read as "no data".
 */
export function replicateStats(values: readonly Replicate[], field?: string): ReplicateStats {
  const { kept, issues } = cleanReplicates(values, field)
  const n = kept.length

  if (n === 0) {
    issues.push(issue(IssueCode.NO_DATA, Severity.INFO, 'no usable replicate values', field))
    return { values: [], n: 0, mean: null, sd: null, cvPercent: null, issues }
  }

  const mean = fsum(kept) / n

  if (n === 1) {
    issues.push(
      issue(
        IssueCode.SINGLE_REPLICATE,
        Severity.INFO,
        'only one replicate; no standard deviation or CV can be computed',
        field,
      ),
    )
    return { values: kept, n: 1, mean, sd: null, cvPercent: null, issues }
  }

  const variance = fsum(kept.map((v) => ipow(v - mean, 2))) / (n - 1)
  const sd = Math.sqrt(variance)

  let cvPercent: number | null = null
  if (mean !== 0) {
    cvPercent = (100 * sd) / Math.abs(mean)
    // CV_FAIL supersedes CV_WARN: one flag per row, and it is the worst one. Two flags for one
    // fact would double-count in the issue panel's severity counts.
    if (cvPercent > CV_FAIL_PERCENT) {
      issues.push(
        issue(
          IssueCode.CV_FAIL,
          Severity.ERROR,
          `replicate CV ${fixed(cvPercent, 1)}% exceeds the ${CV_FAIL_PERCENT}% failure ` +
            'threshold; re-run this sample',
          field,
          { cv: fixed(cvPercent, 3) },
        ),
      )
    } else if (cvPercent > CV_WARN_PERCENT) {
      issues.push(
        issue(
          IssueCode.CV_WARN,
          Severity.WARN,
          `replicate CV ${fixed(cvPercent, 1)}% exceeds the ${CV_WARN_PERCENT}% warning threshold`,
          field,
          { cv: fixed(cvPercent, 3) },
        ),
      )
    }
  }

  return { values: kept, n, mean, sd, cvPercent, issues }
}
