/**
 * Proves features/analysis/analysis-workflow.feature.
 *
 * These steps drive a rendered page rather than the domain, because every claim the feature makes
 * is a claim about a page: that a failed stage leaves its neighbours drawn, that issues are shown
 * grouped by severity and named by stage, that a reload restores the layout, that nothing left the
 * machine. None of those is visible from a returned object, which is why this one feature and the
 * chart feature beside it are the only two that run in a browser.
 *
 * Numbers are read off the signals rather than out of the table cells. A cell is rounded for a
 * reader, and a scenario asserting that a concentration *changed* would pass on two different
 * numbers that round to the same two decimals — which is the one thing these scenarios must not
 * do. What is read from the DOM is what only the DOM can answer: which panels are drawn, what the
 * page says, what a group is tagged with.
 */

import { expect } from 'vitest'
import { Given, Then, When } from 'quickpickle'
import { cleanup } from 'vitest-browser-preact'
import { Severity } from '~/domain/errors'
import {
  EXCEL_COEFFICIENTS,
  REFERENCE_ABSORBANCES,
  referencePlateText,
} from '~/domain/reference'
import { loadSession } from '~/schemas/session'
import * as analysis from '~/state/analysis'
import { type World, expectAt } from '../../support/world'
import {
  SAMPLE_NAMES,
  all,
  appRequests,
  coefficients,
  exists,
  loadingVolumes,
  mount,
  mountOnce,
  one,
  plateOf,
  plateRow,
  reportedConcentrations,
  settle,
  textOf,
  type NetworkWatch,
  type StorageWatch,
} from './support'

/** What a download handed to the browser, as the anchor carried it. */
interface Download {
  readonly name: string
  readonly href: string
}

/** The settings and layout as they stood the moment before a reload. */
interface BeforeReload {
  readonly blankSubtract: boolean
  readonly names: readonly string[]
  readonly assignments: readonly string[]
}

// --- Given -----------------------------------------------------------------

Given("the analysis page with the workbook's plate loaded", async () => {
  analysis.plateText.value = referencePlateText()
  mount()
  await settle()
})

/**
 * The workbook's plate with the layout already applied.
 *
 * Spelled as its own Given rather than folded into the Background, because the first scenario
 * applies a layout as its *action* — and a Background that had already applied one would leave
 * that scenario asserting nothing.
 */
Given('the default layout applied with the names {string} and {string}', async (
  _world: World,
  first: string,
  second: string,
) => {
  mountOnce()
  analysis.applyDefaultLayout([first, second])
  await settle()
})

Given('a plate whose well {string} reads {string}', async (
  _world: World,
  well: string,
  token: string,
) => {
  // Written into the pasted text rather than into the parsed grid, so the sentinel travels the
  // path a real paste takes and is classified by the parser rather than by this step.
  const grid = referencePlateText()
    .split('\n')
    .map((row) => row.split('\t'))
  const match = /^([A-Za-z])(\d{1,2})$/.exec(well.trim())
  const rowIndex = (match?.[1] ?? 'A').toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0)
  const column = Number(match?.[2] ?? '1')
  const target = grid[rowIndex]
  if (target) target[column - 1] = token

  analysis.plateText.value = grid.map((cells) => cells.join('\t')).join('\n')
  mount()
  await settle()
})

/** A plate that was analysed and is about to be replaced, so that "stale" has something to be. */
Given('a previously analysed session', async (world: World) => {
  analysis.plateText.value = referencePlateText()
  mountOnce()
  analysis.applyDefaultLayout([...SAMPLE_NAMES])
  await settle()

  const before = reportedConcentrations()
  expect(
    before.filter((c) => c !== null).length,
    'the session under test never analysed anything',
  ).toBe(2)
  world.previousConcentrations = before
})

/**
 * Nine standards at one absorbance.
 *
 * A design matrix built from a single distinct x has rank one against a cubic's four columns, so
 * the normal equations are singular and the fitter reports SINGULAR_DESIGN rather than returning
 * coefficients that are numerically arbitrary.
 */
Given('a plate whose standards row holds a single repeated absorbance', async () => {
  const flat = plateRow(Array<number>(9).fill(0.5))
  analysis.plateText.value = plateOf([
    flat,
    flat,
    plateRow([0.43, 0.43, 0.43]),
    plateRow([0.36, 0.36, 0.36]),
  ])
  mount()
  await settle()
})

Given('a session with no plate loaded', async () => {
  analysis.reset()
  await settle()
})

// --- When ------------------------------------------------------------------

When('the default layout is applied with the names {string} and {string}', async (
  _world: World,
  first: string,
  second: string,
) => {
  mountOnce()
  analysis.applyDefaultLayout([first, second])
  await settle()
})

When('the analysis page is shown', async () => {
  mount()
  await settle()
})

/**
 * Capture what the page reports, so an action can be asked what it changed.
 *
 * Taken in the When rather than in the Then, because a Then that computed its own baseline would
 * be comparing the result to itself and would pass whatever happened.
 */
function recordBaseline(world: World): void {
  world.beforeCoefficients = coefficients()
  world.beforeConcentrations = reportedConcentrations()
  world.beforeVolumes = loadingVolumes()
}

When('well {string} is corrected to {float}', async (
  world: World,
  well: string,
  value: number,
) => {
  recordBaseline(world)
  analysis.correctWell(well, value)
  await settle()
})

When('the loading target is changed to {int} ug in {int} uL', async (
  world: World,
  protein: number,
  volume: number,
) => {
  recordBaseline(world)
  analysis.desiredProteinUg.value = protein
  analysis.finalVolumeUL.value = volume
  await settle()
})

When('the loading target is set to {int} uL', async (_world: World, volume: number) => {
  analysis.finalVolumeUL.value = volume
  await settle()
})

When('blank subtraction is turned off', async () => {
  analysis.blankSubtract.value = false
  await settle()
})

When('the plate is replaced with text that will not parse', async () => {
  // A rectangular block of words. Every cell fails to parse, so the plate reports
  // NO_READABLE_CELLS once at error severity rather than ninety-six per-cell warnings.
  analysis.plateText.value = plateOf(
    Array.from({ length: 8 }, () => plateRow(Array<string>(12).fill('lorem'))),
  )
  await settle()
})

/**
 * Reload the page the way a browser does: the tab goes away, and what comes back comes back from
 * storage.
 *
 * The tree is unmounted before the signals are cleared, so the persistence effect cannot observe
 * the intermediate empty state and write it over the session being restored. The stored session is
 * read before the clear for the same reason.
 */
When('the page is reloaded', async (world: World) => {
  analysis.persist()
  const stored = loadSession()

  const before: BeforeReload = {
    blankSubtract: analysis.blankSubtract.value,
    names: [...analysis.sampleNames.value],
    assignments: analysis.sampleAssignments.value.map(([name, region]) => `${name}=${region}`),
  }
  expect(before.assignments.length, 'nothing was laid out to restore').toBeGreaterThan(0)
  world.beforeReload = before

  cleanup()
  analysis.reset()
  analysis.restore(stored)
  mount()
  await settle()
})

When('the results are exported', async (world: World) => {
  // The download helper reaches the browser by clicking an anchor. Intercepted at the prototype
  // rather than replaced with a stub, so what is recorded is the call a real download makes and
  // the assertion below can read the URL it was handed.
  const original = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'click')
  const downloads: Download[] = []
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    downloads.push({ name: this.download, href: this.href })
  }

  try {
    for (const testId of ['export-bca-curve.csv', 'export-bca-samples.csv']) {
      one(testId).click()
    }
  } finally {
    if (original) Object.defineProperty(HTMLAnchorElement.prototype, 'click', original)
    else delete (HTMLAnchorElement.prototype as { click?: unknown }).click
  }

  world.downloads = downloads
  await settle()
})

// --- Then: the ordinary path -----------------------------------------------

Then('the curve is fitted from the standards on the plate', () => {
  const fit = analysis.curve.value.value
  expect(fit.fitted, 'the curve did not fit').toBe(true)
  expect(fit.levels.length, 'the curve was fitted from the wrong number of standards').toBe(
    REFERENCE_ABSORBANCES.length,
  )
})

Then('both samples report a concentration', () => {
  const values = reportedConcentrations()
  expect(values.length, 'the page reported a different number of samples').toBe(2)
  for (const value of values) expect(value, 'a sample reported no concentration').not.toBeNull()
})

Then('both samples report a loading volume', () => {
  const values = loadingVolumes()
  expect(values.length, 'the loading table holds a different number of rows').toBe(2)
  for (const value of values) expect(value, 'a sample reported no loading volume').not.toBeNull()
})

// --- Then: the reactive contract, in both directions ------------------------

Then('the curve coefficients change', (world: World) => {
  expect(coefficients(), 'the coefficients did not change').not.toEqual(world.beforeCoefficients)
})

Then('the curve coefficients are unchanged', (world: World) => {
  expect(coefficients(), 'the coefficients changed').toEqual(world.beforeCoefficients)
})

Then("both samples' concentrations change", (world: World) => {
  expect(reportedConcentrations(), 'the concentrations did not change').not.toEqual(
    world.beforeConcentrations,
  )
})

Then("both samples' concentrations are unchanged", (world: World) => {
  expect(reportedConcentrations(), 'the concentrations changed').toEqual(
    world.beforeConcentrations,
  )
})

Then("both samples' loading volumes change", (world: World) => {
  expect(loadingVolumes(), 'the loading volumes did not change').not.toEqual(world.beforeVolumes)
})

// --- Then: the legacy workbook ---------------------------------------------

Then("the curve coefficients are the workbook's four values", () => {
  const fitted = coefficients()
  expect(fitted, 'the curve produced no coefficients at all').not.toBeNull()
  expect(fitted?.length, 'a different number of coefficients').toBe(EXCEL_COEFFICIENTS.length)
  EXCEL_COEFFICIENTS.forEach((expected, i) => {
    expectAt(fitted?.[i] ?? null, String(expected), `coefficient ${i}`)
  })
})

Then('{string} is {float} ug\\/mL in the well', (
  _world: World,
  name: string,
  expected: number,
) => {
  const row = analysis.samples.value.value.find((r) => r.name === name)
  expect(row, `"${name}" is not among the reported samples`).toBeDefined()
  expectAt(row?.concUgPerML ?? null, String(expected), `${name} in the well`)
})

// --- Then: the promises about where the data goes ---------------------------

Then('no network request is made', (world: World) => {
  const watch = world.network as NetworkWatch | undefined
  expect(watch, 'the network watch was never installed').toBeDefined()
  // The dev server's own module and RPC traffic is dropped in `appRequests`; whatever is left
  // came from the page.
  expect(appRequests(watch?.calls ?? []), 'the page made a request').toEqual([])
})

/**
 * Nothing an instrument produced reaches storage.
 *
 * Checked against the values written rather than against the key list, because the layout is meant
 * to persist and does. The claim is about what is *inside* what persisted.
 */
Then('no assay value is written to persistent storage', (world: World) => {
  const watch = world.storage as StorageWatch | undefined
  expect(watch, 'the storage watch was never installed').toBeDefined()

  const forbidden = [
    ...REFERENCE_ABSORBANCES.map(String),
    ...reportedConcentrations().filter((c) => c !== null).map(String),
  ]
  for (const [key, value] of watch?.writes ?? []) {
    for (const reading of forbidden) {
      expect(value.includes(reading), `"${key}" carries the assay value ${reading}`).toBe(false)
    }
  }
})

Then('the download is produced in the browser', (world: World) => {
  const downloads = (world.downloads ?? []) as readonly Download[]
  expect(downloads.length, 'no file was handed to the browser').toBeGreaterThan(0)
  for (const file of downloads) {
    expect(file.name, 'a download carried no filename').not.toBe('')
    // A blob URL names an object in this tab. An http(s) href here would mean the file came back
    // from somewhere, which is the thing this scenario exists to rule out.
    expect(file.href.startsWith('blob:'), `"${file.name}" was not built locally`).toBe(true)
  }
})

// --- Then: the issue panel --------------------------------------------------

Then('the issue panel groups issues by severity', () => {
  const severities = Object.values(Severity)
  const groups = severities.flatMap((s) => all(`issue-group-${s}`))
  expect(groups.length, 'the issue panel drew no severity groups').toBeGreaterThan(0)
  expect(all('issue').length, 'the groups hold no issues').toBeGreaterThan(0)

  for (const group of groups) {
    const severity = group.getAttribute('data-severity') ?? ''
    expect(severities as readonly string[], `"${severity}" is not a severity`).toContain(severity)
    // A group holds its own severity and nothing else, which is what "grouped by" means.
    const inside = [...group.querySelectorAll('[data-testid="issue"]')]
    expect(inside.length, `the ${severity} group is empty`).toBeGreaterThan(0)
  }
})

Then('each issue names the stage it came from', () => {
  const issues = all('issue')
  expect(issues.length, 'there were no issues to name a stage on').toBeGreaterThan(0)
  for (const item of issues) {
    const stage = item.getAttribute('data-stage') ?? ''
    expect(stage, 'an issue carried no stage').not.toBe('')
    // Shown to a reader as well as tagged for a test: the chip is the first thing in the line.
    expect(textOf(item).toLowerCase(), 'the issue does not show its stage').toContain(stage)
  }
})

Then('the issue panel is empty', () => {
  expect(exists('issue-panel'), 'an empty session drew an issue panel').toBe(false)
})

Then('the page states that a plate is needed to begin', () => {
  expect(textOf(one('empty-state'))).toContain('A plate is needed to begin.')
})

// --- Then: a stage whose input failed ---------------------------------------

Then('the plate reports an issue at error severity', () => {
  const codes = analysis.plate.value.issues
    .filter((i) => i.severity === Severity.ERROR)
    .map((i) => i.code)
  expect(codes, 'the plate reported no error').not.toEqual([])
})

Then('the curve reports that its input is unavailable', () => {
  const codes = analysis.curve.value.issues.map((i) => i.code)
  expect(codes, 'the curve did not report an unavailable input').toContain('CURVE_UNAVAILABLE')
})

Then('no sample carries a concentration from the previous plate', (world: World) => {
  const previous = (world.previousConcentrations ?? []) as ReadonlyArray<number | null>
  const stale = previous.filter((c): c is number => c !== null).map((c) => String(c))
  expect(stale.length, 'the scenario recorded no previous concentrations').toBeGreaterThan(0)

  for (const value of reportedConcentrations()) {
    expect(value, 'a sample still reports a concentration').toBeNull()
  }
  // And nothing is left on screen either: a table still showing the old numbers would satisfy
  // the signal check above while telling a reader exactly the wrong thing.
  const shown = textOf(one('samples-table'))
  for (const number of stale) {
    expect(shown.includes(number.slice(0, 8)), 'a stale concentration is still shown').toBe(false)
  }
})

Then('the curve is flagged {string} at error severity', (_world: World, code: string) => {
  const issues = analysis.curve.value.issues
  const found = issues.find((i) => i.code === code)
  const summary = issues.map((i) => `${i.code}@${i.severity}`).join(', ') || 'none'
  expect(found, `expected ${code} on the curve; got: ${summary}`).toBeDefined()
  expect(found?.severity, `${code} was raised at the wrong severity`).toBe(Severity.ERROR)
})

Then('both samples are flagged {string} at error severity', (_world: World, code: string) => {
  const rows = analysis.samples.value.value
  expect(rows.length, 'the page reported a different number of samples').toBe(2)
  for (const row of rows) {
    const found = row.issues.find((i) => i.code === code)
    const summary = row.issues.map((i) => `${i.code}@${i.severity}`).join(', ') || 'none'
    expect(found, `expected ${code} on "${row.name}"; got: ${summary}`).toBeDefined()
    expect(found?.severity, `${code} was raised at the wrong severity`).toBe(Severity.ERROR)
  }
})

// --- Then: one panel fails, the others stay drawn ---------------------------

Then('the loading panel reports an issue at error severity', () => {
  const codes = analysis.loading.value.issues
    .filter((i) => i.severity === Severity.ERROR)
    .map((i) => i.code)
  expect(codes, 'the loading stage reported no error').not.toEqual([])
  expect(exists('loading-panel'), 'the loading panel vanished instead of reporting').toBe(true)
})

Then('the curve panel still shows its coefficients', () => {
  expect(exists('curve-panel'), 'the curve panel vanished').toBe(true)
  expect(coefficients(), 'the curve lost its coefficients').not.toBeNull()
  expect(textOf(one('coefficients')), 'the curve panel says it has none').not.toContain(
    'No coefficients',
  )
})

Then('the samples panel still shows its concentrations', () => {
  expect(exists('samples-panel'), 'the samples panel vanished').toBe(true)
  const values = reportedConcentrations()
  expect(values.length, 'the samples table emptied').toBe(2)
  for (const value of values) expect(value, 'a concentration was lost').not.toBeNull()
})

// --- Then: what survives a reload -------------------------------------------

Then('the sample names and their wells are restored', (world: World) => {
  const before = world.beforeReload as BeforeReload | undefined
  expect(before, 'nothing was recorded before the reload').toBeDefined()
  expect([...analysis.sampleNames.value], 'the names did not come back').toEqual([
    ...(before?.names ?? []),
  ])
  const now = analysis.sampleAssignments.value.map(([name, region]) => `${name}=${region}`)
  expect(now, 'the wells did not come back').toEqual([...(before?.assignments ?? [])])
})

Then('the blank subtraction setting is restored', (world: World) => {
  const before = world.beforeReload as BeforeReload | undefined
  expect(analysis.blankSubtract.value, 'the setting did not come back').toBe(before?.blankSubtract)
})
