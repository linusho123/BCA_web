/**
 * A stage's value and the complaints it raised, kept together.
 *
 * Every domain function in this app already returns issues alongside its result rather than
 * throwing, and the reason is in features/analysis/analysis-workflow.feature: a failure has to
 * degrade one panel instead of the page. What the domain does not do is say *which* stage a
 * complaint came from — `NON_NUMERIC_CELL` reads the same whether the plate or the dilution
 * planner raised it, and the issue panel groups by stage.
 *
 * So the tagging happens here, once, at the point each stage is assembled. Nothing downstream
 * has to remember where an issue came from, and nothing upstream has to know a panel exists.
 */

import type { Issue, Stage } from '~/domain/errors'
import { Severity } from '~/domain/errors'

export interface StagedIssue extends Issue {
  readonly stage: Stage
}

/** A stage's result: whatever it computed, and everything it has to say about it. */
export interface Staged<T> {
  readonly value: T
  readonly issues: readonly StagedIssue[]
}

/** Tag a stage's issues with the stage that raised them. */
export function staged<T>(stage: Stage, value: T, issues: readonly Issue[]): Staged<T> {
  return { value, issues: issues.map((i) => ({ ...i, stage })) }
}

/** True when a stage produced something the next stage must not build on. */
export function failed(stage: Staged<unknown>): boolean {
  return stage.issues.some((i) => i.severity === Severity.ERROR)
}

/**
 * Every issue across the stages, in stage order, severity-first within a stage.
 *
 * Errors before warnings before notes, because a panel that leads with "the blank is a little
 * high" while the curve underneath it did not fit is telling the reader the wrong thing first.
 */
const SEVERITY_ORDER: Readonly<Record<Severity, number>> = {
  [Severity.ERROR]: 0,
  [Severity.WARN]: 1,
  [Severity.INFO]: 2,
}

export function collect(...stages: ReadonlyArray<Staged<unknown>>): StagedIssue[] {
  return stages.flatMap((s) =>
    [...s.issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
  )
}

/** Issues at one severity, for a panel that shows each group under its own heading. */
export function atSeverity(
  issues: readonly StagedIssue[],
  severity: Severity,
): StagedIssue[] {
  return issues.filter((i) => i.severity === severity)
}
