/**
 * The two bench-planning calculators: working reagent, and the standard dilution series.
 *
 * Kept apart from src/state/analysis.ts because they run before the plate exists and share
 * nothing with it. Bundling them would make every reagent keystroke a dependency of the curve.
 *
 * The chosen procedure is the one value both pages and the analysis read, so it lives in
 * `analysis` alongside the rest of what persists rather than being duplicated here.
 */

import { computed, signal } from '@preact/signals'
import { DILUTION_PRESETS, type DilutionPresetId } from '~/domain/constants'
import { type DilutionPlan, dilutionInput, planDilutions } from '~/domain/dilution'
import { type WorkingReagent, workingReagent } from '~/domain/reagent'
import { procedure } from './analysis'

// --- working reagent --------------------------------------------------------

export const nStandards = signal(9)
export const nUnknowns = signal(2)
export const nReplicates = signal(2)
export const excessFactor = signal(1)

export const reagent = computed<WorkingReagent>(() =>
  workingReagent({
    nStandards: nStandards.value,
    nUnknowns: nUnknowns.value,
    nReplicates: nReplicates.value,
    procedure: procedure.value,
    excessFactor: excessFactor.value,
  }),
)

// --- dilution series --------------------------------------------------------

export const preset = signal<DilutionPresetId>('lab_serial')
export const stockConcUgPerUL = signal(2)
export const volumePerWellUL = signal(25)
export const dilutionReplicates = signal(2)
export const overageFactor = signal(2.1)

export const dilution = computed<DilutionPlan>(() =>
  planDilutions(
    dilutionInput({
      stockConcUgPerUL: stockConcUgPerUL.value,
      volumePerWellUL: volumePerWellUL.value,
      nReplicates: dilutionReplicates.value,
      overageFactor: overageFactor.value,
      vials: DILUTION_PRESETS[preset.value].vials,
    }),
  ),
)
