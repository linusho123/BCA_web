/**
 * Kit geometry, manual presets and QC thresholds.
 *
 * Ported from BCA_quarto `src/bca/constants.py` (specdoc §2, §3.5, §3.6).
 *
 * Sources:
 *   - Pierce BCA Protein Assay Kit User Guide, MAN0011430 Rev. D (Tables 1-2, procedures).
 *   - 20240905_BCA_Serial-Dilutions_preparation.xlsx (the lab's own dilution series).
 *
 * Every magic number the assay depends on lives here and nowhere else. The 2.1x overage in
 * particular was a literal in the workbook's F column with no cell explaining it; it is a
 * default here, and an input in the planner.
 */

// --- Plate geometry --------------------------------------------------------
export const PLATE_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const
export const PLATE_COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const
export const WELLS_PER_PLATE = 96

/**
 * The ways a plate can be loaded, ordered by how much retyping each one costs.
 *
 * The order is the recommendation. A reader's CSV is the only route with no transcription step
 * in it at all; typing is the fallback when there is no export to be had; pasting is a text
 * format that has to survive a clipboard. Left to right is read as a ranking whether or not one
 * is meant, so it may as well be the right one — which is why this is a constant the panel
 * renders from rather than the order someone happened to write the tabs in.
 */
export const PLATE_LOAD_ROUTES = Object.freeze([
  { id: 'upload', label: 'Upload', hint: 'CSV or text export from the reader' },
  { id: 'type', label: 'Type', hint: 'enter absorbances well by well' },
  { id: 'paste', label: 'Paste', hint: 'paste the grid from the clipboard' },
] as const)

/** The route the panel opens on, which is the first one and is meant to stay that way. */
export const PLATE_LOAD_ROUTE_THAT_OPENS = PLATE_LOAD_ROUTES[0].label

// --- Working reagent, from "Prepare BCA working reagent" -------------------
export const REAGENT_A_PARTS = 50
export const REAGENT_B_PARTS = 1

// --- QC thresholds (specdoc §3.5, §3.6) ------------------------------------
/** Above this replicate CV, warn. Exclusive: exactly 15% does not warn. */
export const CV_WARN_PERCENT = 15
/** Above this replicate CV, fail. Supersedes the warning rather than joining it. */
export const CV_FAIL_PERCENT = 25
export const POOR_FIT_R_SQUARED = 0.99
export const RECOVERY_LOW_PERCENT = 80
export const RECOVERY_HIGH_PERCENT = 120
/** A blank above this suggests contaminated reagent — nothing else reveals that. */
export const BLANK_ABSORBANCE_WARN = 0.2

/** Smallest volume a P2 delivers reliably. Below this, warn rather than pretend. */
export const MIN_PIPETTABLE_UL = 1.0
export const MIN_PROTEIN_PIPETTABLE_UL = 0.5

/** The lab workbook's 2.1x excess on every source draw (specdoc §3.1). */
export const DEFAULT_OVERAGE_FACTOR = 2.1

/** Points sampled across the calibrated span when checking for a direction reversal. */
export const MONOTONIC_SAMPLES = 200

export const STOCK = 'Stock'

// --- Standard curve models (specdoc §3.7) ----------------------------------
/** All three are inverse calibrations: concentration is the dependent variable. */
export const FitModel = {
  INVERSE_CUBIC: 'inverse_cubic',
  INVERSE_QUADRATIC: 'inverse_quadratic',
  INVERSE_LINEAR: 'inverse_linear',
} as const

export type FitModel = (typeof FitModel)[keyof typeof FitModel]

const FIT_MODEL_DEGREE: Readonly<Record<FitModel, number>> = {
  inverse_cubic: 3,
  inverse_quadratic: 2,
  inverse_linear: 1,
}

const FIT_MODEL_LABEL: Readonly<Record<FitModel, string>> = {
  inverse_cubic: 'Cubic (Excel-equivalent)',
  inverse_quadratic: 'Quadratic',
  inverse_linear: 'Linear (diagnostic)',
}

export function modelDegree(model: FitModel): number {
  return FIT_MODEL_DEGREE[model]
}

export function modelLabel(model: FitModel): string {
  return FIT_MODEL_LABEL[model]
}

// --- Assay procedures (specdoc §2.2) ---------------------------------------
export const Procedure = {
  MICROPLATE_STANDARD: 'microplate_standard',
  MICROPLATE_REDUCED_SAMPLE: 'microplate_reduced_sample',
  TEST_TUBE_STANDARD: 'test_tube_standard',
  TEST_TUBE_ENHANCED: 'test_tube_enhanced',
} as const

export type Procedure = (typeof Procedure)[keyof typeof Procedure]

export interface ProcedureSpec {
  readonly procedure: Procedure
  readonly label: string
  readonly sampleVolumeUL: number
  readonly wrVolumeUL: number
  readonly ratioLabel: string
  readonly workingRangeUgPerML: readonly [number, number]
  readonly incubation: string
}

export const PROCEDURES: Readonly<Record<Procedure, ProcedureSpec>> = Object.freeze({
  microplate_standard: {
    procedure: Procedure.MICROPLATE_STANDARD,
    label: 'Microplate, standard',
    sampleVolumeUL: 25,
    wrVolumeUL: 200,
    ratioLabel: '1:8',
    workingRangeUgPerML: [20, 2000],
    incubation: '37 °C for 30 minutes',
  },
  microplate_reduced_sample: {
    procedure: Procedure.MICROPLATE_REDUCED_SAMPLE,
    label: 'Microplate, reduced sample',
    sampleVolumeUL: 10,
    wrVolumeUL: 200,
    ratioLabel: '1:20',
    workingRangeUgPerML: [125, 2000],
    incubation: '37 °C for 30 minutes',
  },
  test_tube_standard: {
    procedure: Procedure.TEST_TUBE_STANDARD,
    label: 'Test tube, standard',
    sampleVolumeUL: 100,
    wrVolumeUL: 2000,
    ratioLabel: '1:20',
    workingRangeUgPerML: [20, 2000],
    incubation: '37 °C for 30 minutes',
  },
  test_tube_enhanced: {
    procedure: Procedure.TEST_TUBE_ENHANCED,
    label: 'Test tube, enhanced',
    sampleVolumeUL: 100,
    wrVolumeUL: 2000,
    ratioLabel: '1:20',
    workingRangeUgPerML: [5, 250],
    incubation: '60 °C for 30 minutes',
  },
})

// --- Dilution series presets ----------------------------------------------
export interface VialSpec {
  readonly vialId: string
  readonly finalConcUgPerML: number
  /** `Stock`, another vial's id, or null for the blank. */
  readonly source: string | null
}

export function vial(vialId: string, conc: number, source: string | null = null): VialSpec {
  return Object.freeze({ vialId, finalConcUgPerML: conc, source })
}

/**
 * Manual Table 1 — standard working range, 20-2000 µg/mL.
 *
 * Note vial C is drawn from stock here where the lab workbook draws it from vial A. Both are
 * chemically identical, since A is undiluted stock at 2000 µg/mL, so C-from-A and C-from-stock
 * are the same 2x dilution (specdoc §2.4). Supporting both is why the planner takes an
 * arbitrary source graph rather than a fixed chain.
 */
export const MANUAL_TABLE_1: readonly VialSpec[] = Object.freeze([
  vial('A', 2000, STOCK),
  vial('B', 1500, STOCK),
  vial('C', 1000, STOCK),
  vial('D', 750, 'B'),
  vial('E', 500, 'C'),
  vial('F', 250, 'E'),
  vial('G', 125, 'F'),
  vial('H', 25, 'G'),
  vial('I', 0, null),
])

/** Manual Table 2 — enhanced protocol, working range 5-250 µg/mL. */
export const MANUAL_TABLE_2: readonly VialSpec[] = Object.freeze([
  vial('A', 250, STOCK),
  vial('B', 125, 'A'),
  vial('C', 50, 'B'),
  vial('D', 25, 'C'),
  vial('E', 5, 'D'),
  vial('F', 0, null),
])

/** The lab's own series, as encoded in 20240905_BCA_Serial-Dilutions_preparation.xlsx. */
export const LAB_SERIAL_SERIES: readonly VialSpec[] = Object.freeze([
  vial('A', 2000, STOCK),
  vial('B', 1500, STOCK),
  vial('C', 1000, 'A'),
  vial('D', 750, 'B'),
  vial('E', 500, 'C'),
  vial('F', 250, 'E'),
  vial('G', 125, 'F'),
  vial('H', 25, 'G'),
  vial('I', 0, null),
])

export const DILUTION_PRESETS = Object.freeze({
  lab_serial: { label: 'Lab serial series', vials: LAB_SERIAL_SERIES },
  manual_table_1: { label: 'Manual Table 1 (20-2000)', vials: MANUAL_TABLE_1 },
  manual_table_2: { label: 'Manual Table 2 (5-250)', vials: MANUAL_TABLE_2 },
})

export type DilutionPresetId = keyof typeof DILUTION_PRESETS

/**
 * Standard concentrations in **plate-column order**: A1 is the most concentrated tube and the
 * series descends across the row to the blank in A9.
 *
 * This is the direction the series is pipetted at the bench, and `default-plate-layout.feature`
 * AC7 is what fixes it. It is *not* the direction of row 18 of the analysis workbook, which
 * lists the same nine points ascending; `REFERENCE_CONCENTRATIONS` keeps that order because it
 * reproduces the sheet, and the two are reversed views of one series rather than a discrepancy.
 *
 * These once ran ascending here too, which paired every well with the wrong tube's absorbance.
 * Nothing caught it: a polynomial fit does not care what order its points arrive in, so the
 * curve, r-squared and the plotted path were all unchanged, and only the per-standard recovery
 * and the tube letters on screen were wrong. The order is a fact about the plate, so it is
 * asserted through the mapping rather than by reading this list back.
 */
export const ANALYSIS_STANDARD_CONCENTRATIONS: readonly number[] = Object.freeze([
  2000, 1500, 1000, 750, 500, 250, 125, 25, 0,
])

export const ANALYSIS_STANDARD_TUBES: readonly string[] = Object.freeze([
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I',
])
