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
import {
  defaultLayout,
  checkOverlap,
  mapSamples,
  mapStandards,
  parseRegion,
} from '~/domain/layout'
import { EMPTY_PLATE, parsePlate, rawGrid, writeWell, type PlateData } from '~/domain/plate'
import { curvePlot, type CurvePlot } from '~/domain/plot'
import {
  REFERENCE_DESIRED_PROTEIN_UG,
  REFERENCE_DILUTION_FACTOR,
  REFERENCE_FINAL_VOLUME_UL,
  REFERENCE_SAMPLE_NAMES,
  referencePlateText,
} from '~/domain/reference'
import {
  analyseSamples,
  buildLoadingPlan,
  type LoadingRow,
  type SampleInput,
  type SampleResult,
} from '~/domain/samples'
import type { StandardLevel } from '~/domain/curve'
import {
  DEFAULT_SESSION,
  loadPlateText,
  loadSession,
  savePlateText,
  saveSession,
  type StoredSession,
} from '~/schemas/session'
import { validatePlateText } from '~/schemas/upload'
import { collect, failed, staged, type Staged, type StagedIssue } from './stage'

// --- inputs ----------------------------------------------------------------

const restored: StoredSession = loadSession()

/**
 * The reader grid, however it got here — pasted, typed into a well, or read from a file.
 *
 * Held for the tab and no longer. It is the one thing here that came off an instrument, and
 * `src/schemas/session.ts` explains why that earns its own storage rather than riding along
 * with the session: a reload must not cost a researcher ninety-six hand-typed wells, and
 * tomorrow morning's user of a shared laptop must not find yesterday's plate waiting.
 */
export const plateText = signal(loadPlateText())

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
 * Whether there is anything here to compute.
 *
 * An empty session has to look different from a broken one — "an empty session shows what to do
 * rather than a wall of issues". Without this flag the pipeline would run on an empty plate and
 * report, correctly and uselessly, that there is no data in it.
 *
 * The plate alone decides it. An earlier version also counted a non-empty layout, which made
 * every *return* visit look broken: the layout persists and the plate deliberately does not, so
 * a restored session is assignments pointing into a plate that is not there, and the pipeline
 * had one error per mapped well to say so. Nobody arriving at that page has done anything wrong
 * yet, and none of those errors is one they could act on. A layout without a plate is not a
 * session in progress — it is the shape of the next one, waiting for its numbers.
 */
export const started = computed(() => plateText.value.trim() !== '')

/**
 * The plate as 8 by 12 cells of raw text — what the grid on screen renders.
 *
 * Derived rather than held, so the grid, the paste box and an import cannot disagree about what
 * is in a well. There is one plate here, and it is `plateText`.
 */
export const grid = computed(() => rawGrid(plateText.value))

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

// --- painting ---------------------------------------------------------------

/**
 * What a click on a well currently means.
 *
 * A paint tool has a colour loaded, and this is it. `erase` is a target rather than a modifier
 * key because the feature asks for it in the palette beside the names, where it can be reached
 * by tab like everything else.
 */
export type PaintTarget =
  | { readonly kind: 'off' }
  | { readonly kind: 'sample'; readonly name: string }
  | { readonly kind: 'standards' }
  | { readonly kind: 'erase' }

/**
 * Off by default, and that is not timidity.
 *
 * Every well is a text input, so a click already means "put the cursor here" and a keystroke
 * already means "change this reading". Painting has to borrow both, and a grid that painted
 * whenever you clicked into a well to correct a typo would be worse than the text field it
 * replaced. Selecting something from the palette is what arms it; "Type values" disarms it.
 */
export const painting = signal<PaintTarget>({ kind: 'off' })

/** Whether a click on a well currently paints rather than just placing the cursor. */
export const paintArmed = computed(() => painting.value.kind !== 'off')

/** What the given well is assigned to, as the word shown in it. */
export const assignmentOf = computed(() => {
  const map = new Map<string, string>()
  for (const region of standardRegions.value) {
    for (const well of wellsOf(region)) map.set(well, 'std')
  }
  for (const [name, region] of sampleAssignments.value) {
    for (const well of wellsOf(region)) map.set(well, name)
  }
  return map
})

const wellsOf = (region: string): string[] => parseRegion(region).wells

/**
 * Wells back into regions, one region per plate row.
 *
 * Per row, not one region for the lot, because `mapStandards` reads each region as one replicate
 * of the whole series — the nth well of every region is the nth concentration. Row A and row B
 * painted as standards are two reads of nine, which is what the plate is; eighteen wells in one
 * region would be a series of eighteen concentrations that nobody ran.
 */
function regionsByRow(wells: Iterable<string>): string[] {
  const rows = new Map<string, string[]>()
  for (const well of wells) {
    const row = well.slice(0, 1)
    const list = rows.get(row)
    if (list) list.push(well)
    else rows.set(row, [well])
  }
  const column = (w: string) => Number(w.slice(1))
  return [...rows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, list]) => list.sort((a, b) => column(a) - column(b)).join(','))
}

/**
 * Paint the given wells with whatever is selected, taking them off whatever held them before.
 *
 * A well belongs to one thing at a time, so painting is a move rather than an add — which is
 * also what makes painting over a mistake the way to fix it, rather than something to undo
 * first.
 */
export function paintWells(wells: readonly string[]): void {
  const target = painting.value
  const moving = new Set(wells)

  const standards = new Set(standardRegions.value.flatMap(wellsOf))
  const samples = new Map<string, Set<string>>()
  for (const [name, region] of sampleAssignments.value) {
    const held = samples.get(name) ?? new Set<string>()
    for (const well of wellsOf(region)) held.add(well)
    samples.set(name, held)
  }

  for (const well of moving) {
    standards.delete(well)
    for (const held of samples.values()) held.delete(well)
  }

  if (target.kind === 'standards') {
    for (const well of moving) standards.add(well)
  } else if (target.kind === 'sample') {
    const held = samples.get(target.name) ?? new Set<string>()
    for (const well of moving) held.add(well)
    samples.set(target.name, held)
  }

  standardRegions.value = regionsByRow(standards)
  sampleAssignments.value = [...samples.entries()]
    .filter(([, held]) => held.size > 0)
    .flatMap(([name, held]) => regionsByRow(held).map((region) => [name, region] as const))
}

/**
 * Take a whole plate in, from the paste box or a file, and lay its standards out.
 *
 * Sample painting is cleared: carrying assignments from one plate onto another's numbers is how
 * you analyse the wrong wells without noticing. Standards are not carried either — they are
 * re-derived from the plate that just arrived, which for every plate this lab runs puts them
 * back where they were. Typing into a single well is not this; that is editing the plate you
 * already have, and it leaves the layout alone.
 */
export function pasteGrid(text: string): void {
  plateText.value = text
  sampleAssignments.value = []
  standardRegions.value = defaultLayout(parsePlate(text), []).standardRegions
}

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

/**
 * Load the workbook's own session: its plate, its layout, and the loading table it goes with.
 *
 * The loading settings come along deliberately. They are not decoration on the example — the
 * workbook pairs 400 ug with a 1000 uL lane and no dye (its second loading table, rows 56 to
 * 80), and the three only work together. Against this app's ordinary 30 uL lane, 400 ug of
 * MCF7 is 750.7 uL of sample, so an example that brought the target without the volume would
 * open on two errors about a target it had set for itself.
 *
 * Leaving them to whatever the session already held has the same problem from the other side:
 * the example would compute or not depending on what the last visitor was doing, which is not
 * a property a demonstration is allowed to have.
 *
 * The dilution factor is part of the set for the same reason. The workbook read its unknowns at
 * 1 in 2, so at the app's default of 1 the same 400 ug asks for 1501 uL of MCF7 — over the lane
 * by half again, and no volume in the workbook would hold it.
 */
export function loadWorkedExample(): void {
  plateText.value = referencePlateText()
  applyDefaultLayout([...REFERENCE_SAMPLE_NAMES])
  dilutionFactor.value = REFERENCE_DILUTION_FACTOR
  desiredProteinUg.value = REFERENCE_DESIRED_PROTEIN_UG
  finalVolumeUL.value = REFERENCE_FINAL_VOLUME_UL
  includeDye.value = false
}

/**
 * Put what a person typed into one well, exactly as they typed it.
 *
 * The entry stays text all the way to the grid because the grid is an input, not a readout:
 * "OVRFLW" has to survive to be reported as saturation, and a half-typed "0." has to survive
 * long enough for the next keystroke. Whether it is a number is `parsePlate`'s question, and it
 * asks it of the whole grid at once.
 *
 * Typing into a well of an empty session seeds the full 8 by 12 — see `writeWell`.
 */
export function typeIntoWell(well: string, entry: string): void {
  plateText.value = writeWell(plateText.value, well, entry)
}

/**
 * Overwrite one well with a measured value, leaving the rest of the grid as it was.
 *
 * Kept distinct from `typeIntoWell` because the caller here has a number rather than something
 * a person typed; both land in the same place.
 */
export function correctWell(well: string, value: number): void {
  typeIntoWell(well, String(value))
}

/** Forget the plate and the layout, keeping the settings. Used by the "start over" control. */
export function reset(): void {
  plateText.value = ''
  savePlateText('')
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
  savePlateText(plateText.value)
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
