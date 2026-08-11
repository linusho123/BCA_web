/**
 * The analysis pipeline, as one chain of derived values.
 *
 * plate → mapping → curve → samples → loading, each stage reading the one before it. Written
 * with `computed` rather than by hand because features/analysis/analysis-workflow.feature makes
 * a claim in both directions: editing a well recomputes the curve and everything after it, and
 * changing the loading target recomputes nothing before it. A dependency graph gives both for
 * free; a recalculate() function gives neither, and drifts the first time someone adds a stage.
 *
 * The inputs at the top are signals a person edits. Everything below them is derived, and
 * nothing below them is ever assigned to — if a value here needs to change, an input above it
 * is what changes.
 *
 * Assay data is deliberately absent from what persists. See src/schemas/session.ts.
 */

import { computed, signal } from '@preact/signals'
import {
  ANALYSIS_STANDARD_CONCENTRATIONS,
  ANALYSIS_STANDARD_TUBES,
  type FitModel,
} from '~/domain/constants'
import { type CurveFit, fitCurve } from '~/domain/curve'
import { IssueCode, issue, Severity, Stage } from '~/domain/errors'
import { defaultLayout, checkOverlap, mapSamples, mapStandards } from '~/domain/layout'
import { EMPTY_PLATE, parsePlate, type PlateData } from '~/domain/plate'
import { curvePlot, type CurvePlot } from '~/domain/plot'
import {
  analyseSamples,
  buildLoadingPlan,
  type LoadingRow,
  type SampleInput,
  type SampleResult,
} from '~/domain/samples'
import type { StandardLevel } from '~/domain/curve'
import { DEFAULT_SESSION, loadSession, saveSession, type StoredSession } from '~/schemas/session'
import { validatePlateText } from '~/schemas/upload'
import { collect, failed, staged, type Staged, type StagedIssue } from './stage'

// --- inputs ----------------------------------------------------------------

const restored: StoredSession = loadSession()

/** The pasted reader grid. Never persisted — it is the one thing that came off an instrument. */
export const plateText = signal('')

export const sampleNames = signal<readonly string[]>(restored.sampleNames)
export const standardRegions = signal<readonly string[]>(restored.standardRegions)
export const sampleAssignments = signal<ReadonlyArray<readonly [string, string]>>(
  restored.sampleAssignments.map((a) => [a.name, a.region] as const),
)

export const blankSubtract = signal(restored.blankSubtract)
export const fitModel = signal<FitModel>(restored.fitModel)
export const dilutionFactor = signal(restored.dilutionFactor)
export const desiredProteinUg = signal(restored.desiredProteinUg)
export const finalVolumeUL = signal(restored.finalVolumeUL)
export const includeDye = signal(restored.includeDye)
export const dyeFraction = signal(restored.dyeFraction)
export const procedure = signal(restored.procedure)

/**
 * Whether a layout has been chosen at all.
 *
 * An empty session has to look different from a broken one — "an empty session shows what to do
 * rather than a wall of issues". Without this flag the pipeline would run on an empty plate and
 * report, correctly and uselessly, that there is no data in it.
 */
export const started = computed(
  () => plateText.value.trim() !== '' || sampleAssignments.value.length > 0,
)

// --- stages ----------------------------------------------------------------

export const plate = computed<Staged<PlateData>>(() => {
  if (plateText.value.trim() === '') return staged(Stage.PLATE, EMPTY_PLATE, [])
  const checked = validatePlateText(plateText.value)
  if (checked.issues.length > 0) return staged(Stage.PLATE, EMPTY_PLATE, checked.issues)
  const data = parsePlate(checked.text)
  return staged(Stage.PLATE, data, data.issues)
})

interface Mapping {
  readonly levels: readonly StandardLevel[]
  readonly samples: readonly SampleInput[]
}

const NO_MAPPING: Mapping = { levels: [], samples: [] }

export const mapping = computed<Staged<Mapping>>(() => {
  // A plate that did not parse is not a plate with no standards on it. Mapping regions against
  // a grid that failed would report every well as out of bounds — true, and a symptom rather
  // than the cause, on top of the parse error that already said what was wrong.
  if (failed(plate.value)) {
    return staged(Stage.MAPPING, NO_MAPPING, [
      issue(
        IssueCode.EMPTY_INPUT,
        Severity.ERROR,
        'the plate could not be read, so its wells cannot be mapped',
        'plate',
      ),
    ])
  }

  const data = plate.value.value
  const regions = standardRegions.value
  const assignments = sampleAssignments.value
  if (regions.length === 0 && assignments.length === 0) {
    return staged(Stage.MAPPING, NO_MAPPING, [])
  }

  const standards = mapStandards(data, regions, ANALYSIS_STANDARD_CONCENTRATIONS, {
    tubeIds: ANALYSIS_STANDARD_TUBES,
  })
  const unknowns = mapSamples(data, assignments)
  const overlap = checkOverlap(regions, assignments)

  return staged(
    Stage.MAPPING,
    { levels: standards.levels, samples: unknowns.samples },
    [...standards.issues, ...unknowns.issues, ...overlap],
  )
})

/**
 * A curve with no coefficients, for when there is nothing to fit.
 *
 * `fitCurve([])` already produces exactly this, complaint included, so it is used rather than
 * a hand-built stand-in — a second definition of "not fitted" is a second thing to keep true.
 */
const emptyFit = (): CurveFit => fitCurve([], { blankSubtract: false })

export const curve = computed<Staged<CurveFit>>(() => {
  if (failed(mapping.value)) {
    return staged(Stage.CURVE, emptyFit(), [
      issue(
        IssueCode.CURVE_UNAVAILABLE,
        Severity.ERROR,
        'the standards could not be read from the plate, so no curve was fitted',
        'standards',
      ),
    ])
  }
  const levels = mapping.value.value.levels
  if (levels.length === 0) return staged(Stage.CURVE, emptyFit(), [])

  const fit = fitCurve(levels, { model: fitModel.value, blankSubtract: blankSubtract.value })
  return staged(Stage.CURVE, fit, fit.issues)
})

export const samples = computed<Staged<readonly SampleResult[]>>(() => {
  const inputs = mapping.value.value.samples
  if (inputs.length === 0) return staged(Stage.SAMPLES, [], [])

  // `analyseSamples` raises CURVE_UNAVAILABLE on every row itself when the fit failed, which is
  // what the feature asks for — the complaint belongs to the sample that cannot be reported,
  // not to a banner above the table.
  const results = analyseSamples(curve.value.value, inputs, {
    dilutionFactor: dilutionFactor.value,
  })
  return staged(Stage.SAMPLES, results, results.flatMap((r) => r.issues))
})

export const loading = computed<Staged<readonly LoadingRow[]>>(() => {
  const results = samples.value.value
  if (results.length === 0) return staged(Stage.LOADING, [], [])

  const rows = buildLoadingPlan(results, {
    desiredProteinUg: desiredProteinUg.value,
    finalVolumeUL: finalVolumeUL.value,
    includeDye: includeDye.value,
    dyeFraction: dyeFraction.value,
  })
  return staged(Stage.LOADING, rows, rows.flatMap((r) => r.issues))
})

/** The chart's geometry. Derived, so the plot cannot disagree with the table beside it. */
export const plot = computed<CurvePlot>(() =>
  curvePlot(curve.value.value, samples.value.value),
)

/** Every complaint from every stage, in workflow order. */
export const issues = computed<readonly StagedIssue[]>(() =>
  started.value
    ? collect(plate.value, mapping.value, curve.value, samples.value, loading.value)
    : [],
)

// --- actions ---------------------------------------------------------------

/**
 * Lay the plate out the way this assay is always run, naming the unknowns.
 *
 * The regions this produces are the regions a user would have typed, so a layout applied here
 * and one entered by hand travel the same path from this point on.
 */
export function applyDefaultLayout(names: readonly string[]): void {
  const layout = defaultLayout(plate.value.value, names)
  sampleNames.value = names
  standardRegions.value = layout.standardRegions
  sampleAssignments.value = layout.assignments
}

/** Overwrite one well, leaving the rest of the pasted grid as it was. */
export function correctWell(well: string, value: number): void {
  const match = /^([A-Za-z])(\d{1,2})$/.exec(well.trim())
  if (!match) return
  const row = (match[1] as string).toUpperCase()
  const column = Number(match[2])

  const data = plate.value.value
  const r = data.rowLabels.indexOf(row)
  if (r < 0 || column < 1 || column > data.nCols) return

  // Rewritten as text rather than as parsed values, because the pasted grid is the input and
  // everything else is derived from it. Editing the parsed copy would leave the two disagreeing
  // the moment anything re-parsed.
  const grid = data.values.map((cells) => cells.map((cell) => (cell === null ? '-' : String(cell))))
  const target = grid[r]
  if (target === undefined) return
  target[column - 1] = String(value)
  plateText.value = grid.map((cells) => cells.join('\t')).join('\n')
}

/** Forget the plate and the layout, keeping the settings. Used by the "start over" control. */
export function reset(): void {
  plateText.value = ''
  sampleNames.value = []
  standardRegions.value = []
  sampleAssignments.value = []
}

/**
 * The settings and the layout, in the shape storage takes.
 *
 * Assembled explicitly rather than by spreading the signals, so that adding an assay-carrying
 * signal above cannot quietly add it to what gets written to disk.
 */
export function snapshot(): StoredSession {
  return {
    version: 1,
    sampleNames: [...sampleNames.value],
    sampleAssignments: sampleAssignments.value.map(([name, region]) => ({ name, region })),
    standardRegions: [...standardRegions.value],
    blankSubtract: blankSubtract.value,
    fitModel: fitModel.value,
    dilutionFactor: dilutionFactor.value,
    desiredProteinUg: desiredProteinUg.value,
    finalVolumeUL: finalVolumeUL.value,
    includeDye: includeDye.value,
    dyeFraction: dyeFraction.value,
    procedure: procedure.value,
  }
}

/** Write the session. Called by the app shell on change; safe to call when nothing changed. */
export function persist(): void {
  saveSession(snapshot())
}

/** Restore the signals from a stored session. The plate is not among them, by design. */
export function restore(session: StoredSession = DEFAULT_SESSION): void {
  sampleNames.value = session.sampleNames
  standardRegions.value = session.standardRegions
  sampleAssignments.value = session.sampleAssignments.map((a) => [a.name, a.region] as const)
  blankSubtract.value = session.blankSubtract
  fitModel.value = session.fitModel
  dilutionFactor.value = session.dilutionFactor
  desiredProteinUg.value = session.desiredProteinUg
  finalVolumeUL.value = session.finalVolumeUL
  includeDye.value = session.includeDye
  dyeFraction.value = session.dyeFraction
  procedure.value = session.procedure
}
