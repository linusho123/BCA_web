/**
 * The reference dataset, verbatim from the two workbooks this app replaces.
 *
 * Ported from the golden fixtures in BCA_quarto's specdoc §3.1, §3.2 and §3.3.
 *
 * This is not test scaffolding, which is why it lives in the domain rather than beside the
 * tests. It is the evidence for the only claim that makes this app safe to adopt — that a
 * result computed here reconciles with one computed in the spreadsheet — and the validation
 * page renders it so a reviewer can see the numbers agree without running anything.
 *
 * Every value below was read out of the workbooks and is not to be adjusted to make a test
 * pass. If the code disagrees with these numbers, the code is what changed.
 */

import { LAB_SERIAL_SERIES } from './constants'
import { type CurveFit, fitCurve, standardLevel, type StandardLevel } from './curve'
import { dilutionInput, type DilutionInput } from './dilution'

// --- 20240905_BCA_Serial-Dilutions_preparation.xlsx ------------------------

/** Stock 2 µg/µL, 25 µL per well, 2 replicates, 2.1x overage — the workbook's own inputs. */
export const REFERENCE_DILUTION_INPUT: DilutionInput = dilutionInput({
  stockConcUgPerUL: 2,
  volumePerWellUL: 25,
  nReplicates: 2,
  overageFactor: 2.1,
  vials: LAB_SERIAL_SERIES,
})

export interface GoldenVialRow {
  readonly vialId: string
  readonly concUgPerML: number
  readonly source: string | null
  readonly dilutionFactor: number | null
  readonly volumeFromSourceUL: number
  readonly volumeDiluentUL: number
  readonly totalVolumeUL: number
  readonly leftoverUL: number
}

/** The nine rows the workbook produces for those inputs. Reproduced to 1e-12. */
export const GOLDEN_DILUTION_ROWS: readonly GoldenVialRow[] = [
  { vialId: 'A', concUgPerML: 2000, source: 'Stock', dilutionFactor: 1, volumeFromSourceUL: 105, volumeDiluentUL: 0, totalVolumeUL: 105, leftoverUL: 52.5 },
  { vialId: 'B', concUgPerML: 1500, source: 'Stock', dilutionFactor: 4 / 3, volumeFromSourceUL: 78.75, volumeDiluentUL: 26.25, totalVolumeUL: 105, leftoverUL: 52.5 },
  { vialId: 'C', concUgPerML: 1000, source: 'A', dilutionFactor: 2, volumeFromSourceUL: 52.5, volumeDiluentUL: 52.5, totalVolumeUL: 105, leftoverUL: 52.5 },
  { vialId: 'D', concUgPerML: 750, source: 'B', dilutionFactor: 2, volumeFromSourceUL: 52.5, volumeDiluentUL: 52.5, totalVolumeUL: 105, leftoverUL: 105 },
  { vialId: 'E', concUgPerML: 500, source: 'C', dilutionFactor: 2, volumeFromSourceUL: 52.5, volumeDiluentUL: 52.5, totalVolumeUL: 105, leftoverUL: 52.5 },
  { vialId: 'F', concUgPerML: 250, source: 'E', dilutionFactor: 2, volumeFromSourceUL: 52.5, volumeDiluentUL: 52.5, totalVolumeUL: 105, leftoverUL: 52.5 },
  { vialId: 'G', concUgPerML: 125, source: 'F', dilutionFactor: 2, volumeFromSourceUL: 52.5, volumeDiluentUL: 52.5, totalVolumeUL: 105, leftoverUL: 84 },
  { vialId: 'H', concUgPerML: 25, source: 'G', dilutionFactor: 5, volumeFromSourceUL: 21, volumeDiluentUL: 84, totalVolumeUL: 105, leftoverUL: 105 },
  { vialId: 'I', concUgPerML: 0, source: null, dilutionFactor: null, volumeFromSourceUL: 0, volumeDiluentUL: 50, totalVolumeUL: 50, leftoverUL: 50 },
]

// --- BCA-assay-analysis_template.xlsx --------------------------------------

/** Row 18 of the analysis sheet: the standard concentrations, ascending. */
export const REFERENCE_CONCENTRATIONS: readonly number[] = [
  0, 25, 125, 250, 500, 750, 1000, 1500, 2000,
]

/** Row 22: the mean absorbance measured at each of those concentrations. */
export const REFERENCE_ABSORBANCES: readonly number[] = [
  0.132, 0.159, 0.262, 0.391, 0.636, 0.895, 1.125, 1.479, 2.051,
]

/** Row 19: the vial letters, which run opposite to the concentrations. */
export const REFERENCE_TUBE_IDS: readonly string[] = [
  'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A',
]

/**
 * The coefficients Excel's LINEST returns for that data, highest power first.
 *
 * These are the four numbers in cells F25 through I25 of the analysis sheet. Our fitter
 * reproduces them to a maximum relative error around 7e-15.
 */
export const EXCEL_COEFFICIENTS: readonly number[] = [
  -167.37214725621925, 555.321622093881, 579.0359699552389, -71.92532320741356,
]

/** The RIPA sheet's two unknowns, at a dilution factor of 2. */
export const REFERENCE_SAMPLES = [
  {
    name: 'MCF7',
    absorbance: 0.43,
    concUgPerML: 266.4318544865975,
    concUgPerUL: 0.532863708973195,
    proteinUL: 750.6609912894659,
  },
  {
    name: 'RPMI8226',
    absorbance: 0.36,
    concUgPerML: 200.68839329745327,
    concUgPerUL: 0.40137678659490655,
    proteinUL: 996.5698400084705,
  },
] as const

/** The desired protein mass in the workbook's loading table. */
export const REFERENCE_DESIRED_PROTEIN_UG = 400

/**
 * The rest of the workbook's loading table: a 1000 uL lane, no dye, unknowns read at 1 in 2.
 *
 * These four numbers are one setting, not four. 400 ug of MCF7 at this dilution is 750.7 uL of
 * sample, which fits a 1000 uL lane and nothing smaller, and only with the 250 uL the dye would
 * otherwise take. Change one and the table stops balancing — which is exactly the arithmetic
 * the workbook got wrong at its cell K29, and the reason this app exists.
 *
 * From the second loading table of the RIPA sheet, rows 56 to 80.
 */
export const REFERENCE_FINAL_VOLUME_UL = 1000

/** The unknowns were read at a 1 in 2 dilution; the concentrations above already include it. */
export const REFERENCE_DILUTION_FACTOR = 2

/** The unknowns, in the order the plate lays them out. */
export const REFERENCE_SAMPLE_NAMES: readonly string[] = REFERENCE_SAMPLES.map((s) => s.name)

/** The nine standards as the curve takes them, one replicate each. */
export function referenceLevels(): StandardLevel[] {
  return REFERENCE_CONCENTRATIONS.map((conc, i) =>
    standardLevel(conc, [REFERENCE_ABSORBANCES[i] as number], REFERENCE_TUBE_IDS[i] as string),
  )
}

/** The workbook's own curve: the reference standards fitted the way the sheet fits them. */
export function referenceFit(): CurveFit {
  return fitCurve(referenceLevels(), { blankSubtract: false })
}

/**
 * A whole plate laid out the way this assay is run: standards along row A, a second read along
 * row B, and the two unknowns in rows C and D at three replicates each. Tab-separated, the way
 * a reader puts it on the clipboard.
 *
 * Un-plated wells carry "-" rather than nothing at all, which is what the readers in this lab
 * write and what keeps the exported block rectangular. A row that ended early would be reported
 * as ragged, and rightly so — there is no way to tell a row that stops from a row with a hole
 * in it once the trailing cells are gone.
 */
export function referencePlateText(emptyToken = '-'): string {
  const pad = (values: readonly (number | string)[]): string =>
    [...values, ...Array<string>(12 - values.length).fill(emptyToken)].join('\t')
  const blank = pad([])
  // Reversed, because `REFERENCE_ABSORBANCES` is in the workbook's ascending order while a plate
  // is pipetted with the most concentrated tube in column 1. The worked example is the one thing
  // in the app a new user copies, so it has to be laid out the way their own plate will be —
  // and if it were not reversed here, the app would now read it upside down.
  const rowA = [...REFERENCE_ABSORBANCES].reverse()
  return [
    pad(rowA),
    pad(rowA),
    pad([0.43, 0.43, 0.43]),
    pad([0.36, 0.36, 0.36]),
    blank,
    blank,
    blank,
    blank,
  ].join('\n')
}
