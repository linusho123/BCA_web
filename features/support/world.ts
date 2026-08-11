/**
 * Shared helpers for the step definitions.
 *
 * Steps address the domain and nothing else — no component is rendered here and no signal is
 * read. A scenario that passes against the domain and fails in the browser is a UI bug, and
 * keeping the acceptance layer at this level is what makes that distinction possible.
 *
 * Nothing in this file registers a step. It holds the two things every step module needs: a
 * typed view of the QuickPickle world, and the parsers that turn a Gherkin phrase into a value.
 */

import { expect } from 'vitest'
import { type Issue, type Severity, bySeverity } from '~/domain/errors'
import { Procedure } from '~/domain/constants'
import { isClose } from '~/domain/linalg'

/**
 * The world is a plain bag, fresh per scenario.
 *
 * It is typed as an index signature rather than as a union of every domain result, because a
 * step module that needed a new slot would otherwise have to edit a type shared with sixteen
 * other feature files.
 */
export interface World {
  [key: string]: unknown
}

/** Read a slot that a previous step must have filled, failing by name if it did not. */
export function slot<T>(world: World, key: string): T {
  const value = world[key]
  if (value === undefined || value === null) {
    throw new Error(
      `the scenario asked for "${key}" before a step put one there; check the Given steps`,
    )
  }
  return value as T
}

/**
 * Parse a number written in a Gherkin table or phrase.
 *
 * `Number` is fine here and nowhere else in the app: this text comes from a feature file that
 * is read in review, not from a user. What it must not do is silently accept a typo, so
 * anything that is not a number throws rather than becoming NaN.
 */
export function number(text: string): number {
  const trimmed = text.trim()
  const value = Number(trimmed)
  if (!Number.isFinite(value)) {
    throw new Error(`"${text}" is not a number that a step can use`)
  }
  return value
}

/**
 * Parse a replicate list as written in the features: `0.5, empty, 0.52`.
 *
 * `empty` is an un-plated well and `nothing` is an empty list; both appear in the features
 * because both happen on a real plate and they are not the same thing. `NaN` is written out
 * literally, because a parsed cell can produce one.
 */
export function replicateList(text: string): (number | null)[] {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === 'nothing') return []
  return trimmed.split(',').map((token) => {
    const t = token.trim()
    if (t === 'empty') return null
    if (t === 'NaN') return NaN
    return number(t)
  })
}

/** Parse a comma-separated list of numbers, e.g. `2000, 1500, 1000`. */
export function numberList(text: string): number[] {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .map(number)
}

/**
 * Resolve a procedure written the way the features write it: `microplate standard`.
 *
 * The features spell procedures in prose because that is what the researcher reading them
 * calls them; the enum spells them in snake_case because that is what an export carries.
 */
export function procedure(label: string): Procedure {
  const key = label.trim().toLowerCase().replace(/[\s-]+/g, '_')
  const aliases: Record<string, Procedure> = {
    microplate_standard: Procedure.MICROPLATE_STANDARD,
    microplate_reduced: Procedure.MICROPLATE_REDUCED_SAMPLE,
    microplate_reduced_sample: Procedure.MICROPLATE_REDUCED_SAMPLE,
    test_tube_standard: Procedure.TEST_TUBE_STANDARD,
    test_tube_enhanced: Procedure.TEST_TUBE_ENHANCED,
  }
  const found = aliases[key]
  if (!found) throw new Error(`"${label}" is not a procedure this app implements`)
  return found
}

/** Resolve a severity written as the features write it: `warn`, not `Severity.WARN`. */
export function severity(text: string): Severity {
  const value = text.trim().toLowerCase()
  if (value !== 'info' && value !== 'warn' && value !== 'error') {
    throw new Error(`"${text}" is not a severity`)
  }
  return value
}

/**
 * Assert an issue is present at a given severity, naming what was found instead.
 *
 * The message matters more than it looks: a failing acceptance test that says only
 * "expected true to be false" costs a trip into the domain to find out which code came back.
 */
export function expectIssue(
  issues: readonly Issue[],
  code: string,
  level: string,
  detail = '',
): Issue {
  const wanted = severity(level)
  const found = issues.find((i) => i.code === code)
  const summary = issues.map((i) => `${i.code}@${i.severity}`).join(', ') || 'none'
  expect(found, `expected ${code} among the issues${detail}; got: ${summary}`).toBeDefined()
  expect(
    found?.severity,
    `${code} was raised, but at ${found?.severity} rather than ${wanted}`,
  ).toBe(wanted)
  return found as Issue
}

/** Assert nothing at ERROR severity came back, naming the errors if any did. */
export function expectNoErrors(issues: readonly Issue[]): void {
  const errors = bySeverity(issues, 'error')
  expect(errors.map((i) => i.code), 'expected no errors').toEqual([])
}

/** Assert the issue list is empty, naming what was in it if it was not. */
export function expectNoIssues(issues: readonly Issue[]): void {
  expect(issues.map((i) => i.code), 'expected no issues at all').toEqual([])
}

/** Assert a code is absent, which several features check explicitly. */
export function expectNoIssue(issues: readonly Issue[], code: string): void {
  expect(
    issues.map((i) => i.code),
    `expected ${code} not to be raised`,
  ).not.toContain(code)
}

/**
 * Compare a computed number against the value written in a feature, at the precision written.
 *
 * A feature that says `47058.82` is stating a volume to two decimals, and asserting exact
 * equality against it would fail on the seventeenth digit for reasons no reader of the feature
 * could see. The number of decimals in the text is the tolerance.
 */
export function expectAt(actual: number | null, text: string, label: string): void {
  const expected = number(text)
  const decimals = (text.trim().split('.')[1] ?? '').length
  expect(actual, `${label} was absent`).not.toBeNull()
  // A feature that writes 266.4318544865975 is quoting a double back at full width, not stating
  // a quantity to thirteen decimals. Reproducing one of those through a different route — a
  // fitted curve rather than the workbook's — agrees to about a part in 1e-12 and no further,
  // so a relative match at 1e-9 counts, and the decimals still set the bar for everything else.
  if (isClose(actual as number, expected, 1e-9)) return
  expect(actual, label).toBeCloseTo(expected, decimals === 0 ? 9 : decimals)
}

/**
 * The coefficients the scenario last produced, whichever layer produced them.
 *
 * Two features fit polynomials: one drives the fitter directly and one goes through the standard
 * curve. They share the sentences that talk about coefficients, and QuickPickle's step registry
 * is global, so those sentences can only be registered once — which means they have to be able
 * to find the coefficients without knowing which of the two layers the scenario used.
 *
 * Null means the fit produced none. A `CurveFit` says so by coming back unfitted with an empty
 * coefficient list; `polyfit` says so by having thrown, which its steps record as a null.
 */
export function producedCoefficients(world: World): number[] | null {
  const fit = world.fit as { fitted: boolean; coefficients: readonly number[] } | undefined
  if (fit !== undefined) return fit.fitted ? [...fit.coefficients] : null
  const fitted = world.fitted as number[] | null | undefined
  if (fitted === undefined) {
    throw new Error('no fit has been run; check that a When step ran before this Then')
  }
  return fitted
}

/** Parse a value that may be written as `absent`, meaning null. */
export function maybeNumber(text: string): number | null {
  return text.trim() === 'absent' ? null : number(text)
}
