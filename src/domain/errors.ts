/**
 * Issue codes, severities and the two exception types the core is allowed to throw.
 *
 * Ported from BCA_quarto `src/bca/errors.py` / `assets/bca/errors.js` (specdoc §6).
 *
 * The governing decision: **a validation failure is data, not an exception.** Every rule in
 * specdoc §6 produces an `Issue` carrying a machine code, a severity, a human message and a
 * field locator, and the function returns it alongside whatever it managed to compute.
 *
 * That is not a stylistic preference. A researcher types a series, a region or a target volume
 * through many invalid intermediate states, and a throw at that boundary blanks the panel they
 * are editing instead of annotating the row they are editing. See
 * features/analysis/analysis-workflow.feature — "A stage that fails degrades its own panel".
 *
 * The exceptions below are reserved for genuine programming errors: asking an unfitted curve
 * for a prediction, or handing the fitter a rank-deficient design. Never for user input.
 */

export const Severity = {
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const

export type Severity = (typeof Severity)[keyof typeof Severity]

/**
 * Mirrors `IssueCode` in the source project, section order and grouping included, so that a
 * code seen in an export from either app means the same thing.
 */
export const IssueCode = {
  // -- §6.1 inputs ---------------------------------------------------------
  NON_POSITIVE_STOCK: 'NON_POSITIVE_STOCK',
  NON_POSITIVE_VOLUME: 'NON_POSITIVE_VOLUME',
  NON_POSITIVE_REPLICATES: 'NON_POSITIVE_REPLICATES',
  OVERAGE_BELOW_ONE: 'OVERAGE_BELOW_ONE',
  NEGATIVE_CONCENTRATION: 'NEGATIVE_CONCENTRATION',
  NON_NUMERIC_INPUT: 'NON_NUMERIC_INPUT',

  // -- §6.2 dilution graph -------------------------------------------------
  UNKNOWN_SOURCE: 'UNKNOWN_SOURCE',
  CIRCULAR_SOURCE: 'CIRCULAR_SOURCE',
  SELF_SOURCE: 'SELF_SOURCE',
  DUPLICATE_VIAL_ID: 'DUPLICATE_VIAL_ID',
  CONCENTRATION_INCREASE: 'CONCENTRATION_INCREASE',
  DILUTION_FACTOR_ONE_FROM_VIAL: 'DILUTION_FACTOR_ONE_FROM_VIAL',
  INSUFFICIENT_SOURCE_VOLUME: 'INSUFFICIENT_SOURCE_VOLUME',
  BLANK_WITH_SOURCE: 'BLANK_WITH_SOURCE',
  VOLUME_BELOW_PIPETTABLE: 'VOLUME_BELOW_PIPETTABLE',
  EMPTY_VIAL_LIST: 'EMPTY_VIAL_LIST',

  // -- §6.3 plate parsing and import ---------------------------------------
  EMPTY_INPUT: 'EMPTY_INPUT',
  RAGGED_ROWS: 'RAGGED_ROWS',
  UNEXPECTED_SHAPE: 'UNEXPECTED_SHAPE',
  NON_NUMERIC_CELL: 'NON_NUMERIC_CELL',
  OVERFLOW_CELL: 'OVERFLOW_CELL',
  NEGATIVE_ABSORBANCE: 'NEGATIVE_ABSORBANCE',
  NO_READABLE_CELLS: 'NO_READABLE_CELLS',
  BINARY_UPLOAD: 'BINARY_UPLOAD',
  UNDECODABLE_UPLOAD: 'UNDECODABLE_UPLOAD',

  // -- §5.7 well mapping ---------------------------------------------------
  BAD_REGION_SYNTAX: 'BAD_REGION_SYNTAX',
  REGION_OUT_OF_BOUNDS: 'REGION_OUT_OF_BOUNDS',
  REGION_LENGTH_MISMATCH: 'REGION_LENGTH_MISMATCH',
  OVERLAPPING_REGIONS: 'OVERLAPPING_REGIONS',
  UNREADABLE_WELL_IN_REGION: 'UNREADABLE_WELL_IN_REGION',
  EMPTY_REGION: 'EMPTY_REGION',
  UNNAMED_SAMPLE: 'UNNAMED_SAMPLE',

  // -- §6.4 curve ----------------------------------------------------------
  INSUFFICIENT_STANDARDS: 'INSUFFICIENT_STANDARDS',
  SINGULAR_DESIGN: 'SINGULAR_DESIGN',
  NO_BLANK_STANDARD: 'NO_BLANK_STANDARD',
  DUPLICATE_STANDARD_CONC: 'DUPLICATE_STANDARD_CONC',
  NON_MONOTONIC_CURVE: 'NON_MONOTONIC_CURVE',
  POOR_FIT: 'POOR_FIT',
  RECOVERY_OUT_OF_RANGE: 'RECOVERY_OUT_OF_RANGE',
  HIGH_BLANK: 'HIGH_BLANK',
  LEVEL_DROPPED: 'LEVEL_DROPPED',

  // -- §3.5 / §6.5 replicate QC, samples and loading -----------------------
  NO_DATA: 'NO_DATA',
  SINGLE_REPLICATE: 'SINGLE_REPLICATE',
  CV_WARN: 'CV_WARN',
  CV_FAIL: 'CV_FAIL',
  EXTRAPOLATED: 'EXTRAPOLATED',
  BELOW_BLANK: 'BELOW_BLANK',
  NEGATIVE_CONCENTRATION_RESULT: 'NEGATIVE_CONCENTRATION_RESULT',
  INSUFFICIENT_VOLUME: 'INSUFFICIENT_VOLUME',
  PROTEIN_VOLUME_UNPIPETTABLE: 'PROTEIN_VOLUME_UNPIPETTABLE',
  ZERO_CONCENTRATION_DIVISION: 'ZERO_CONCENTRATION_DIVISION',
  DILUTION_FACTOR_INVALID: 'DILUTION_FACTOR_INVALID',
  CURVE_UNAVAILABLE: 'CURVE_UNAVAILABLE',

  // -- §2.3 working reagent ------------------------------------------------
  NO_SAMPLES: 'NO_SAMPLES',
  NEGATIVE_COUNT: 'NEGATIVE_COUNT',
  EXCESS_BELOW_ONE: 'EXCESS_BELOW_ONE',
  PLATE_OVERFLOW: 'PLATE_OVERFLOW',
  DYE_FRACTION_INVALID: 'DYE_FRACTION_INVALID',
} as const

export type IssueCode = (typeof IssueCode)[keyof typeof IssueCode]

/** Which stage of the workflow raised an issue — the analysis page groups by this. */
export const Stage = {
  DILUTION: 'dilution',
  PLATE: 'plate',
  MAPPING: 'mapping',
  CURVE: 'curve',
  SAMPLES: 'samples',
  LOADING: 'loading',
  REAGENT: 'reagent',
} as const

export type Stage = (typeof Stage)[keyof typeof Stage]

export interface Issue {
  readonly code: IssueCode
  readonly severity: Severity
  readonly message: string
  /** Locator for the input that caused it: a field name, a vial id, a well label. */
  readonly field: string | null
  /** Sorted key/value pairs, so two issues built from the same facts compare equal. */
  readonly context: ReadonlyArray<readonly [string, string]>
}

/**
 * Build an `Issue`, normalising free-form context to sorted string pairs.
 *
 * Sorting is what makes an exported issue stable: without it the context order would follow
 * object literal order, and a refactor that reorders two keys would show up as a diff in every
 * exported CSV.
 */
export function issue(
  code: IssueCode,
  severity: Severity,
  message: string,
  field?: string | null,
  context?: Readonly<Record<string, string | number | boolean | null>>,
): Issue {
  const pairs: Array<readonly [string, string]> = []
  if (context) {
    for (const key of Object.keys(context).sort()) {
      pairs.push([key, String(context[key])] as const)
    }
  }
  return Object.freeze({
    code,
    severity,
    message,
    field: field ?? null,
    context: Object.freeze(pairs),
  })
}

/** True when any issue is ERROR severity, i.e. the result must not be used. */
export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.severity === Severity.ERROR)
}

/** Issues of one severity, for the grouped issue panel. */
export function bySeverity(issues: readonly Issue[], severity: Severity): Issue[] {
  return issues.filter((i) => i.severity === severity)
}

/** True when `code` appears anywhere in `issues`. */
export function hasCode(issues: readonly Issue[], code: IssueCode): boolean {
  return issues.some((i) => i.code === code)
}

/** Programming errors — genuine misuse of the core, never bad user input. */
export class BcaError extends Error {}

/** Not enough points to fit the requested degree. */
export class InsufficientDataError extends BcaError {}

/** The design matrix is rank-deficient; there is no unique least-squares solution. */
export class SingularMatrixError extends BcaError {}

/** `predict` was called on a `CurveFit` that has no coefficients. */
export class CurveNotFittedError extends BcaError {}
