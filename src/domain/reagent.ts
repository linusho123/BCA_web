/**
 * BCA working reagent calculator.
 *
 * Ported from BCA_quarto `src/bca/reagent.py` (specdoc §2.3).
 *
 * Implements the manual's formula:
 *
 *     (n standards + n unknowns) x n replicates x volume of WR per sample = total WR
 *
 * and the 50:1 Reagent A to B split. Neither reference workbook computes this — researchers
 * work it out at the bench, which is where a 50:1 ratio becomes a 51:1 one.
 *
 * The excess factor is applied after the manual's base calculation and reported separately, so
 * the audit trail distinguishes what the protocol requires from what was actually prepared.
 */

import {
  PROCEDURES,
  Procedure,
  REAGENT_A_PARTS,
  REAGENT_B_PARTS,
  WELLS_PER_PLATE,
} from './constants'
import { type Issue, IssueCode, Severity, hasErrors, issue } from './errors'
import { num } from './format'

export interface WorkingReagent {
  readonly nWells: number
  readonly volumePerSampleUL: number
  /** Before the excess factor — the volume the manual's formula gives. */
  readonly baseVolumeUL: number
  readonly excessFactor: number
  readonly totalVolumeUL: number
  readonly totalVolumeML: number
  readonly reagentAUL: number
  readonly reagentBUL: number
  readonly procedure: Procedure
  readonly issues: readonly Issue[]
}

export interface WorkingReagentInput {
  readonly nStandards: number
  readonly nUnknowns: number
  readonly nReplicates: number
  readonly procedure?: Procedure
  readonly excessFactor?: number
}

export function workingReagent(input: WorkingReagentInput): WorkingReagent {
  const {
    nStandards,
    nUnknowns,
    nReplicates,
    procedure = Procedure.MICROPLATE_STANDARD,
    excessFactor = 1,
  } = input
  const spec = PROCEDURES[procedure]
  const issues: Issue[] = []

  if (nStandards < 0 || nUnknowns < 0) {
    issues.push(
      issue(
        IssueCode.NEGATIVE_COUNT,
        Severity.ERROR,
        `sample counts cannot be negative (standards=${nStandards}, unknowns=${nUnknowns})`,
        'counts',
      ),
    )
  }
  if (nReplicates < 1) {
    issues.push(
      issue(
        IssueCode.NON_POSITIVE_REPLICATES,
        Severity.ERROR,
        `at least one replicate is required, got ${nReplicates}`,
        'nReplicates',
      ),
    )
  }
  if (excessFactor < 1) {
    issues.push(
      issue(
        IssueCode.EXCESS_BELOW_ONE,
        Severity.ERROR,
        `excess factor must be at least 1.0, got ${num(excessFactor)}`,
        'excessFactor',
      ),
    )
  }
  if (nStandards === 0 && nUnknowns === 0) {
    issues.push(
      issue(
        IssueCode.NO_SAMPLES,
        Severity.ERROR,
        'no standards and no unknowns; nothing to prepare reagent for',
        'counts',
      ),
    )
  }

  if (hasErrors(issues)) {
    return {
      nWells: 0,
      volumePerSampleUL: spec.wrVolumeUL,
      baseVolumeUL: 0,
      excessFactor,
      totalVolumeUL: 0,
      totalVolumeML: 0,
      reagentAUL: 0,
      reagentBUL: 0,
      procedure,
      issues,
    }
  }

  const nWells = (nStandards + nUnknowns) * nReplicates
  const baseVolumeUL = nWells * spec.wrVolumeUL
  const totalVolumeUL = baseVolumeUL * excessFactor

  const isMicroplate =
    procedure === Procedure.MICROPLATE_STANDARD ||
    procedure === Procedure.MICROPLATE_REDUCED_SAMPLE
  if (isMicroplate && nWells > WELLS_PER_PLATE) {
    const plates = Math.ceil(nWells / WELLS_PER_PLATE)
    issues.push(
      issue(
        IssueCode.PLATE_OVERFLOW,
        Severity.WARN,
        `${nWells} wells are needed, more than the ${WELLS_PER_PLATE} on one plate; ` +
          `${plates} plates are required`,
        'nWells',
        { plates },
      ),
    )
  }

  const parts = REAGENT_A_PARTS + REAGENT_B_PARTS
  return {
    nWells,
    volumePerSampleUL: spec.wrVolumeUL,
    baseVolumeUL,
    excessFactor,
    totalVolumeUL,
    totalVolumeML: totalVolumeUL / 1000,
    reagentAUL: (totalVolumeUL * REAGENT_A_PARTS) / parts,
    reagentBUL: (totalVolumeUL * REAGENT_B_PARTS) / parts,
    procedure,
    issues,
  }
}
