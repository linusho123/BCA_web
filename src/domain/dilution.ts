/**
 * BSA serial dilution planner.
 *
 * Ported from BCA_quarto `src/bca/dilution.py` (specdoc §3.1, §6.1, §6.2).
 *
 * Replaces 20240905_BCA_Serial-Dilutions_preparation.xlsx. The formulas are reproduced exactly:
 *
 *   dilutionFactor   = sourceConc / finalConc                        (workbook column E)
 *   volumeFromSource = volumeToPrepare / factor * overageFactor      (column F)
 *   volumeDiluent    = factor * volumeFromSource - volumeFromSource  (column G)
 *   totalVolume      = volumeFromSource + volumeDiluent              (column H)
 *   leftover         = totalVolume - sum(children's draws)           (column I, CORRECTED)
 *
 * The one deliberate correction is that last line. The workbook writes `I7 = H7 - F9`, which
 * hard-codes the assumption that vial A feeds vial C. Rearrange the series — and the whole
 * point of an editable planner is that you can — and those references keep computing, silently
 * against the wrong rows. Deriving consumption from the actual source graph is the fix.
 */

import {
  DEFAULT_OVERAGE_FACTOR,
  LAB_SERIAL_SERIES,
  MIN_PIPETTABLE_UL,
  STOCK,
  type VialSpec,
} from './constants'
import { type Issue, IssueCode, Severity, hasErrors, issue } from './errors'
import { fixed, num } from './format'
import { isClose } from './linalg'

export interface DilutionInput {
  readonly stockConcUgPerUL: number
  readonly volumePerWellUL: number
  readonly nReplicates: number
  readonly overageFactor: number
  readonly vials: readonly VialSpec[]
  /** Derived: workbook B4 = B2 * B3. */
  readonly volumeToPrepareUL: number
}

export interface VialPlan {
  readonly vialId: string
  readonly finalConcUgPerML: number
  readonly finalConcUgPerUL: number
  readonly source: string | null
  /** Absent for a blank, which is diluent only and divides by nothing. */
  readonly dilutionFactor: number | null
  readonly volumeFromSourceUL: number
  readonly volumeDiluentUL: number
  readonly totalVolumeUL: number
  readonly leftoverUL: number
  readonly issues: readonly Issue[]
}

export interface DilutionPlan {
  readonly spec: DilutionInput
  readonly vials: readonly VialPlan[]
  readonly volumeToPrepareUL: number
  readonly totalWaterUL: number
  readonly ok: boolean
  /** Plan-level issues. Vial-level issues live on the vial they belong to. */
  readonly issues: readonly Issue[]
}

export interface DilutionInputOptions {
  stockConcUgPerUL?: number
  volumePerWellUL?: number
  nReplicates?: number
  overageFactor?: number
  vials?: readonly VialSpec[]
}

/** Build a `DilutionInput`, filling in the reference defaults and the derived volume. */
export function dilutionInput(options: DilutionInputOptions = {}): DilutionInput {
  const {
    stockConcUgPerUL = 2,
    volumePerWellUL = 25,
    nReplicates = 2,
    overageFactor = DEFAULT_OVERAGE_FACTOR,
    vials = LAB_SERIAL_SERIES,
  } = options
  return {
    stockConcUgPerUL,
    volumePerWellUL,
    nReplicates,
    overageFactor,
    vials,
    volumeToPrepareUL: volumePerWellUL * nReplicates,
  }
}

const isBlank = (v: VialSpec): boolean => v.finalConcUgPerML === 0

function validateInputs(spec: DilutionInput): Issue[] {
  const issues: Issue[] = []
  if (spec.stockConcUgPerUL <= 0) {
    issues.push(
      issue(
        IssueCode.NON_POSITIVE_STOCK,
        Severity.ERROR,
        `stock concentration must be greater than 0, got ${num(spec.stockConcUgPerUL)}`,
        'stockConcUgPerUL',
      ),
    )
  }
  if (spec.volumePerWellUL <= 0) {
    issues.push(
      issue(
        IssueCode.NON_POSITIVE_VOLUME,
        Severity.ERROR,
        `volume per well must be greater than 0, got ${num(spec.volumePerWellUL)}`,
        'volumePerWellUL',
      ),
    )
  }
  if (spec.nReplicates < 1) {
    issues.push(
      issue(
        IssueCode.NON_POSITIVE_REPLICATES,
        Severity.ERROR,
        `at least one replicate is required, got ${spec.nReplicates}`,
        'nReplicates',
      ),
    )
  }
  if (spec.overageFactor < 1) {
    issues.push(
      issue(
        IssueCode.OVERAGE_BELOW_ONE,
        Severity.ERROR,
        `overage factor must be at least 1.0 (no shortfall), got ${num(spec.overageFactor)}`,
        'overageFactor',
      ),
    )
  }
  if (spec.vials.length === 0) {
    issues.push(
      issue(IssueCode.EMPTY_VIAL_LIST, Severity.ERROR, 'no vials were specified', 'vials'),
    )
  }
  return issues
}

/** Check ids, sources and concentrations before any arithmetic runs. */
function validateGraph(spec: DilutionInput): Issue[] {
  const issues: Issue[] = []
  const seen = new Set<string>()
  const byId = new Map<string, number>()

  for (const v of spec.vials) {
    if (seen.has(v.vialId)) {
      issues.push(
        issue(
          IssueCode.DUPLICATE_VIAL_ID,
          Severity.ERROR,
          `vial id "${v.vialId}" appears more than once`,
          v.vialId,
        ),
      )
    }
    seen.add(v.vialId)
    byId.set(v.vialId, v.finalConcUgPerML)

    if (!Number.isFinite(v.finalConcUgPerML)) {
      // What arrives from the editable series table is text, and `Number('1e3 ug')` is NaN.
      // Every comparison against NaN is false, so an unchecked one walks past the negative and
      // increase guards below and produces a whole series of NaN volumes with nothing named.
      issues.push(
        issue(
          IssueCode.NON_NUMERIC_INPUT,
          Severity.ERROR,
          `vial ${v.vialId} has a concentration that is not a number (${num(v.finalConcUgPerML)})`,
          v.vialId,
        ),
      )
      continue
    }

    if (v.finalConcUgPerML < 0) {
      issues.push(
        issue(
          IssueCode.NEGATIVE_CONCENTRATION,
          Severity.ERROR,
          `vial ${v.vialId} has a negative concentration (${num(v.finalConcUgPerML)})`,
          v.vialId,
        ),
      )
    }
  }

  for (const v of spec.vials) {
    const source = v.source
    if (source === null) {
      if (!isBlank(v)) {
        issues.push(
          issue(
            IssueCode.UNKNOWN_SOURCE,
            Severity.ERROR,
            `vial ${v.vialId} has no source but is not a blank`,
            v.vialId,
          ),
        )
      }
      continue
    }

    if (source === v.vialId) {
      issues.push(
        issue(
          IssueCode.SELF_SOURCE,
          Severity.ERROR,
          `vial ${v.vialId} lists itself as its source`,
          v.vialId,
        ),
      )
      continue
    }

    if (isBlank(v)) {
      issues.push(
        issue(
          IssueCode.BLANK_WITH_SOURCE,
          Severity.WARN,
          `blank vial ${v.vialId} declares source "${source}"; a blank is diluent only`,
          v.vialId,
        ),
      )
    }

    if (source !== STOCK && !byId.has(source)) {
      issues.push(
        issue(
          IssueCode.UNKNOWN_SOURCE,
          Severity.ERROR,
          `vial ${v.vialId} names source "${source}", which is not a known vial`,
          v.vialId,
          { source },
        ),
      )
    }
  }

  issues.push(...detectCycles(spec))
  return issues
}

/** Report every vial that participates in a source cycle, each cycle once. */
function detectCycles(spec: DilutionInput): Issue[] {
  const parents = new Map<string, string | null>()
  for (const v of spec.vials) parents.set(v.vialId, v.source)
  const issues: Issue[] = []
  const reported = new Set<string>()

  for (const start of parents.keys()) {
    const seen: string[] = []
    let node: string | null | undefined = start
    while (node != null && parents.has(node) && !seen.includes(node)) {
      seen.push(node)
      node = parents.get(node)
    }
    if (node != null && seen.includes(node) && !reported.has(node)) {
      const cycle = seen.slice(seen.indexOf(node))
      for (const c of cycle) reported.add(c)
      const head = cycle[0] as string
      issues.push(
        issue(
          IssueCode.CIRCULAR_SOURCE,
          Severity.ERROR,
          `circular dilution source: ${[...cycle, head].join(' -> ')}`,
          head,
          { cycle: cycle.join(',') },
        ),
      )
    }
  }
  return issues
}

/**
 * Indices of `spec.vials` ordered so every source precedes the vials drawing from it.
 *
 * This is the order the rows are computed in *and* the order they are reported in, because the
 * report is a pipetting sequence: a researcher works down it with a pipette, and a row that
 * asks them to draw from a vial further down the page is one they cannot follow.
 *
 * Kahn's algorithm taking the earliest-declared ready vial at each step, rather than a sort by
 * depth from stock. Both satisfy the constraint, but this one leaves an already-valid series
 * exactly as the researcher typed it — the workbook's A through I stays A through I instead of
 * being rearranged into depth bands with the blank hoisted to the front for having no source.
 *
 * Assumes the graph has been validated as acyclic. A vial left unresolved is appended in its
 * declared position rather than dropped: a planner that silently loses a row is worse than one
 * that shows it in an odd place.
 */
function topologicalOrder(spec: DilutionInput): number[] {
  const indexById = new Map<string, number>()
  spec.vials.forEach((v, index) => {
    if (!indexById.has(v.vialId)) indexById.set(v.vialId, index)
  })

  const resolved = new Set<number>()
  const order: number[] = []

  const ready = (index: number): boolean => {
    const source = (spec.vials[index] as VialSpec).source
    if (source == null || source === STOCK) return true
    const sourceIndex = indexById.get(source)
    // An unknown source is already an error elsewhere; treat it as a root so the row survives.
    return sourceIndex === undefined || resolved.has(sourceIndex)
  }

  let progressed = true
  while (progressed && order.length < spec.vials.length) {
    progressed = false
    for (let index = 0; index < spec.vials.length; index += 1) {
      if (resolved.has(index) || !ready(index)) continue
      resolved.add(index)
      order.push(index)
      progressed = true
    }
  }

  for (let index = 0; index < spec.vials.length; index += 1) {
    if (!resolved.has(index)) order.push(index)
  }
  return order
}

/** Build the pipetting scheme for a BSA standard series. */
export function planDilutions(spec: DilutionInput): DilutionPlan {
  const planIssues = [...validateInputs(spec), ...validateGraph(spec)]
  const volumeToPrepareUL = spec.volumeToPrepareUL

  if (hasErrors(planIssues)) return makePlan(spec, [], volumeToPrepareUL, planIssues)

  const concPerUL = new Map<string, number>()
  for (const v of spec.vials) concPerUL.set(v.vialId, v.finalConcUgPerML / 1000)

  const rows = new Map<string, VialPlan>()
  const drawsFrom = new Map<string, number>()

  const order = topologicalOrder(spec)
  for (const index of order) {
    const v = spec.vials[index] as VialSpec
    const vialIssues: Issue[] = []
    const finalUL = concPerUL.get(v.vialId) as number

    if (v.source === null) {
      // Blank: diluent only. No division, so there is no zero-concentration hazard here.
      rows.set(v.vialId, {
        vialId: v.vialId,
        finalConcUgPerML: v.finalConcUgPerML,
        finalConcUgPerUL: finalUL,
        source: null,
        dilutionFactor: null,
        volumeFromSourceUL: 0,
        volumeDiluentUL: volumeToPrepareUL,
        totalVolumeUL: volumeToPrepareUL,
        leftoverUL: volumeToPrepareUL,
        issues: [],
      })
      continue
    }

    const sourceConc =
      v.source === STOCK ? spec.stockConcUgPerUL : (concPerUL.get(v.source) as number)

    let dilutionFactor: number | null = null
    let volumeFromSourceUL = 0
    let volumeDiluentUL = 0
    let totalVolumeUL = 0

    if (finalUL <= 0) {
      vialIssues.push(
        issue(
          IssueCode.NEGATIVE_CONCENTRATION,
          Severity.ERROR,
          `vial ${v.vialId} has a non-positive target concentration but declares a source; ` +
            'a zero-concentration vial must be a blank',
          v.vialId,
        ),
      )
    } else if (sourceConc < finalUL) {
      vialIssues.push(
        issue(
          IssueCode.CONCENTRATION_INCREASE,
          Severity.ERROR,
          `vial ${v.vialId} (${num(v.finalConcUgPerML)} ug/mL) is more concentrated than its ` +
            `source "${v.source}" (${num(sourceConc * 1000)} ug/mL); dilution cannot concentrate`,
          v.vialId,
        ),
      )
    } else {
      dilutionFactor = sourceConc / finalUL
      volumeFromSourceUL = (volumeToPrepareUL / dilutionFactor) * spec.overageFactor
      volumeDiluentUL = dilutionFactor * volumeFromSourceUL - volumeFromSourceUL
      totalVolumeUL = volumeFromSourceUL + volumeDiluentUL

      if (v.source !== STOCK && isClose(dilutionFactor, 1, 1e-12)) {
        vialIssues.push(
          issue(
            IssueCode.DILUTION_FACTOR_ONE_FROM_VIAL,
            Severity.WARN,
            `vial ${v.vialId} is a 1:1 transfer from "${v.source}"; consider sourcing it directly`,
            v.vialId,
          ),
        )
      }
      if (volumeFromSourceUL > 0 && volumeFromSourceUL < MIN_PIPETTABLE_UL) {
        vialIssues.push(
          issue(
            IssueCode.VOLUME_BELOW_PIPETTABLE,
            Severity.WARN,
            `vial ${v.vialId} requires ${fixed(volumeFromSourceUL, 3)} uL from its source, ` +
              `below the ${MIN_PIPETTABLE_UL} uL reliable pipetting minimum`,
            v.vialId,
            { volume: fixed(volumeFromSourceUL, 4) },
          ),
        )
      }
      if (v.source !== STOCK) {
        drawsFrom.set(v.source, (drawsFrom.get(v.source) ?? 0) + volumeFromSourceUL)
      }
    }

    rows.set(v.vialId, {
      vialId: v.vialId,
      finalConcUgPerML: v.finalConcUgPerML,
      finalConcUgPerUL: finalUL,
      source: v.source,
      dilutionFactor,
      volumeFromSourceUL,
      volumeDiluentUL,
      totalVolumeUL,
      leftoverUL: totalVolumeUL,
      issues: vialIssues,
    })
  }

  // Leftover derives from the real graph, not from a fixed row offset — the workbook's bug.
  // Rows come back in pipetting order, which is the order they were computed in.
  const finished: VialPlan[] = []
  for (const index of order) {
    const v = spec.vials[index] as VialSpec
    const row = rows.get(v.vialId) as VialPlan
    const consumed = drawsFrom.get(v.vialId) ?? 0
    const rowIssues = [...row.issues]
    if (consumed > row.totalVolumeUL && !isClose(consumed, row.totalVolumeUL, 1e-12)) {
      rowIssues.push(
        issue(
          IssueCode.INSUFFICIENT_SOURCE_VOLUME,
          Severity.ERROR,
          `vial ${v.vialId} produces ${fixed(row.totalVolumeUL, 2)} uL but its children draw ` +
            `${fixed(consumed, 2)} uL; increase the overage factor or the volume to prepare`,
          v.vialId,
          { consumed: fixed(consumed, 4), produced: fixed(row.totalVolumeUL, 4) },
        ),
      )
    }
    // The leftover is reported negative rather than clipped to zero. A clipped zero reads as
    // "nothing left", which is true but useless; the negative number says how much short.
    finished.push({ ...row, leftoverUL: row.totalVolumeUL - consumed, issues: rowIssues })
  }

  return makePlan(spec, finished, volumeToPrepareUL, planIssues)
}

function makePlan(
  spec: DilutionInput,
  vials: readonly VialPlan[],
  volumeToPrepareUL: number,
  issues: readonly Issue[],
): DilutionPlan {
  const all = [...issues, ...vials.flatMap((v) => v.issues)]
  return {
    spec,
    vials,
    volumeToPrepareUL,
    totalWaterUL: vials.reduce((acc, v) => acc + v.volumeDiluentUL, 0),
    ok: !hasErrors(all),
    issues,
  }
}

/** Every issue in a plan, plan-level and vial-level, for the issue panel. */
export function allDilutionIssues(plan: DilutionPlan): Issue[] {
  return [...plan.issues, ...plan.vials.flatMap((v) => v.issues)]
}
