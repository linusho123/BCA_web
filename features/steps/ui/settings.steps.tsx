/**
 * Steps for features/analysis/settings-persistence.feature.
 *
 * These mount `App`, not `AnalysisPage`. Every other browser step file mounts the analysis page
 * directly, which is both reasonable and the precise reason this defect survived a green suite:
 * the persistence effect lives on that page, so a suite that only ever mounts that page tests a
 * world in which the effect always runs. The subject here is a setting changed somewhere else,
 * and it cannot be reached without the shell that routes between the two.
 *
 * Storage is read back through `loadSession`, the same function the app restores from — never
 * off the signal. A signal holding the right procedure is what the app computed; what a reload
 * gets is what reached the store, and the whole failure is the gap between those two.
 */

import { Given, Then, When } from 'quickpickle'
import { expect } from 'vitest'
import { cleanup, render } from 'vitest-browser-preact'
import { referencePlateText } from '~/domain/reference'
import { loadSession } from '~/schemas/session'
import * as analysis from '~/state/analysis'
import { App } from '~/ui/App'
import type { World } from '../../support/world'
import { one, settle, textOf } from './support'

/** Show a page by its nav tab, the way a person moves between them. */
async function goTo(page: 'protocol' | 'dilutions' | 'analysis'): Promise<void> {
  one(`nav-${page}`).click()
  await settle()
}

function mountApp(): void {
  cleanup()
  render(<App />)
}

Given('a fresh session with nothing stored', async () => {
  analysis.reset()
  mountApp()
  await goTo('protocol')
})

/**
 * Choose a procedure from the select on the protocol page.
 *
 * Dispatched as a `change`, which is the event the control listens for and the one a real
 * selection fires. Setting `procedure.value` from the step would skip the page entirely and
 * prove nothing about whether choosing it on that page writes anything.
 */
async function chooseProcedure(value: string): Promise<void> {
  await goTo('protocol')
  const select = one('procedure') as HTMLSelectElement
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
}

Given('the procedure set to {string} on the protocol page', async (_w: unknown, value: string) => {
  await chooseProcedure(value)
})

When('the procedure is set to {string} on the protocol page', async (
  _w: unknown, value: string,
) => {
  await chooseProcedure(value)
})

Given('the analysis page visited', async () => {
  await goTo('analysis')
})

Given('the workbook\'s plate analysed with the default layout', async () => {
  mountApp()
  await goTo('analysis')
  analysis.sampleNames.value = ['MCF7', 'RPMI8226']
  analysis.pasteGrid(referencePlateText())
  analysis.applyDefaultLayout(['MCF7', 'RPMI8226'])
  await settle()
  // The plate has to have been through the pipeline before AC4 means anything: the step below
  // forbids storing values the analysis produced, and nothing has been produced until now.
  expect(analysis.samples.value.value.length, 'nothing was analysed').toBeGreaterThan(0)
})

/**
 * A reload, restoring only from what actually reached the store.
 *
 * Deliberately *not* the analysis feature's reload step, which calls `analysis.persist()` first.
 * That call is right there — it stands in for the writes the running app would have made — but
 * here it would supply the very write whose absence is the defect, and the scenario would pass
 * against the broken app.
 */
When('the page is reloaded from what was stored', async () => {
  const stored = loadSession()
  cleanup()
  analysis.reset()
  analysis.restore(stored)
  mountApp()
  await goTo('protocol')
})

// "the session is started over" is registered by analysis.steps.tsx, which clicks the real
// button rather than calling reset(). That is the better step — the promise "start over" makes
// is made by a button — and the registry is shared, so this file uses it as it stands. The only
// thing it needs from this file is that the analysis page be on screen when it runs.
Given('the analysis page shown ready to start over', async () => {
  await goTo('analysis')
})

/** Remember how much had been written, so the next assertion is about what follows only. */
function markWrites(world: World): void {
  const watch = world.storage as StorageWatch | undefined
  ;(world as { writesBefore?: number }).writesBefore = watch?.writes.length ?? 0
}

// Navigation is the render the shell actually gets — a reagent keystroke re-renders the protocol
// page and leaves the shell alone, so only this step exercises an over-eager writer in it.
When('every page is visited without changing a setting', async (world: World) => {
  markWrites(world)
  await goTo('dilutions')
  await goTo('analysis')
  await goTo('protocol')
})

When('the number of unknowns is changed on the protocol page', async (world: World) => {
  await goTo('protocol')
  // Marked after arriving, so the navigation above is not counted against the keystroke.
  markWrites(world)

  const field = [...document.querySelectorAll('label')]
    .find((l) => l.textContent.trim().startsWith('Unknowns'))
    ?.querySelector('input')
  expect(field, 'no Unknowns field on the protocol page').toBeTruthy()
  field!.value = '5'
  field!.dispatchEvent(new Event('input', { bubbles: true }))
  field!.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
})

Then('the stored procedure is {string}', (_w: unknown, expected: string) => {
  expect(loadSession().procedure, 'the procedure that reached storage').toBe(expected)
})

Then('what is stored agrees with what the protocol page shows', () => {
  const shown = (one('procedure') as HTMLSelectElement).value
  expect(loadSession().procedure, 'stored vs shown').toBe(shown)
})

Then('the protocol page shows {string}', async (_w: unknown, label: string) => {
  // Navigates rather than assuming: the scenarios reach this from the protocol page after a
  // reload and from the analysis page after starting over, and what is being asserted is what
  // the protocol page shows in both cases.
  await goTo('protocol')
  const select = one('procedure') as HTMLSelectElement
  const chosen = select.selectedOptions[0]?.textContent.trim()
  expect(chosen, 'the procedure the page shows').toBe(label)
})

/**
 * The working range as the page states it, found by its term rather than by a test id.
 *
 * It is one of five facts in a description list, and what makes it the right assertion is that
 * it is downstream of the setting: the range is read out of the procedure's spec, so a procedure
 * restored into the control but not into the numbers fails here and nowhere else.
 */
// The slash is escaped because "/" is alternation in a Cucumber expression: unescaped, "ug/mL"
// asks for "ug" or "mL" and matches neither sentence.
Then('the working range shown is {int} to {int} ug\\/mL', (
  _w: unknown, low: number, high: number,
) => {
  const term = [...document.querySelectorAll('dt')].find((t) => textOf(t) === 'Working range')
  expect(term, 'no working range on the page').toBeTruthy()
  const shown = textOf(term!.nextElementSibling!)
  expect(shown, 'the working range the page states').toBe(`${low}–${high} µg/mL`)
})

Then('no assay value has been written to storage that outlives the tab', (world: World) => {
  const watch = world.storage as StorageWatch | undefined
  expect(watch, 'the storage watch was never installed').toBeDefined()

  const readings = analysis.samples.value.value
    .map((s) => s.concUgPerML)
    .filter((c): c is number => c !== null)
    .map(String)
  expect(readings.length, 'no concentrations to check against').toBeGreaterThan(0)

  for (const [key, value] of watch?.writes ?? []) {
    for (const reading of readings) {
      expect(value.includes(reading), `"${key}" carries the assay value ${reading}`).toBe(false)
    }
  }
})

Then('the session was written once for the procedure and not again', (world: World) => {
  const watch = world.storage as StorageWatch | undefined
  const before = (world as { writesBefore?: number }).writesBefore ?? 0
  const since = (watch?.writes ?? []).slice(before)
  expect(since.map(([key]) => key).join(', '), 'storage written by a reagent keystroke').toBe('')
})

interface StorageWatch {
  readonly writes: ReadonlyArray<readonly [string, string]>
  stop: () => void
}
