/**
 * Proves features/analysis/standards-direction.feature.
 *
 * Runs in a browser because the feature's whole reason for existing is that the failure it guards
 * is invisible from the numbers: reading the series backwards fits a smooth curve with a healthy
 * r-squared, so what makes it *checkable* is the tube letters in the standards table and the
 * setting shown beside the model. Both of those are on the page or nowhere.
 *
 * The standards table is therefore read out of the DOM here, against the convention the other UI
 * steps follow of reading numbers off the signals. That convention exists because rendered cells
 * are rounded and a "changed" assertion could pass on two numbers that round alike. It does not
 * apply to these: a tube letter is not rounded, and the pairing being right in the signal while
 * the table shows something else is precisely the defect this feature is about.
 */

import { expect } from 'vitest'
import { Given, Then, When } from 'quickpickle'
import { StandardsDirection, directionLabel } from '~/domain/constants'
import { REFERENCE_ABSORBANCES } from '~/domain/reference'
import { loadPlateText, loadSession } from '~/schemas/session'
import * as analysis from '~/state/analysis'
import type { World } from '../../support/world'
import { cleanup } from 'vitest-browser-preact'
import { mount, mountOnce, one, plateOf, plateRow, settle, textOf } from './support'

/** One row of the rendered standards table, as a reader sees it. */
interface StandardRow {
  readonly tube: string
  readonly concentration: number
}

/**
 * The standards table as rendered, tube and concentration per row.
 *
 * The columns are found by their header text rather than by index, so that adding a column to
 * `standardColumns` moves this with it instead of silently shifting it onto the wrong one — a
 * failure that would read as the direction being wrong.
 */
function standardRows(): StandardRow[] {
  const table = one('standards-table')
  const headers = [...table.querySelectorAll('thead th')].map((h) => textOf(h))
  const tubeAt = headers.findIndex((h) => h.startsWith('Tube'))
  const concAt = headers.findIndex((h) => h.startsWith('Nominal') || h.startsWith('Concentration'))
  expect(tubeAt, `the standards table has no tube column; it has: ${headers.join(', ')}`)
    .toBeGreaterThanOrEqual(0)
  expect(concAt, `the standards table has no concentration column; it has: ${headers.join(', ')}`)
    .toBeGreaterThanOrEqual(0)

  return [...table.querySelectorAll('tbody tr')].map((row) => {
    const cells = [...row.querySelectorAll('td')]
    return {
      tube: textOf(cells[tubeAt] ?? row),
      concentration: Number(textOf(cells[concAt] ?? row).replace(/[^0-9.-]/g, '')),
    }
  })
}

// --- Given -----------------------------------------------------------------

/**
 * The same nine absorbances, pipetted the other way: column 1 is the blank.
 *
 * Built by reversing the standard row of the workbook's own plate rather than by inventing
 * numbers, because AC5 is an equality between two readings of *one* series. Two different sets of
 * absorbances could not tell that apart from a coincidence.
 */
Given('a plate whose standard row runs from the blank up to 2000 ug\\/mL', async () => {
  const reversed = plateRow(REFERENCE_ABSORBANCES)
  analysis.plateText.value = plateOf([
    reversed,
    reversed,
    plateRow([0.43, 0.43, 0.43]),
    plateRow([0.36, 0.36, 0.36]),
  ])
  mount()
  await settle()
})

Given('blank subtraction turned off', async () => {
  analysis.blankSubtract.value = false
  await settle()
})

Given('the standards direction switched to ascending', async () => {
  mountOnce()
  analysis.standardsDirection.value = StandardsDirection.ASCENDING
  await settle()
})

// --- When ------------------------------------------------------------------

When('the standards direction is switched to ascending', async (world: World) => {
  mountOnce()
  world.beforeCoefficients = analysis.curve.value.value.fitted
    ? [...analysis.curve.value.value.coefficients]
    : null
  world.beforeRowA = analysis.plate.value.value.values[0]?.map((cell) => cell) ?? []
  world.beforeMeanAbs = analysis.samples.value.value.map((r) => r.meanAbs)
  analysis.standardsDirection.value = StandardsDirection.ASCENDING
  await settle()
})

/**
 * A reload, with the plate the tab was holding.
 *
 * The workflow feature's own reload step deliberately does not restore the plate — it is proving
 * that no absorbance comes back from local storage. This one does, through the real
 * `loadPlateText`, because the direction is only legible where the curve panel is and the curve
 * panel needs a plate. Both are true of the shipped app: the settings come from `localStorage`
 * and the plate from `sessionStorage`, which is why two steps are needed rather than one.
 */
When('the page is reloaded with the plate the tab was holding', async () => {
  analysis.persist()
  // Both stores are read before anything is cleared: `reset` empties the tab's plate slot on its
  // way past, so reading it afterwards would find the reload's own wreckage rather than what the
  // tab was holding. A real reload reads first because the old page is already gone.
  const stored = loadSession()
  const held = loadPlateText()
  expect(held, 'the tab held no plate to reload').not.toBe('')

  cleanup()
  analysis.reset()
  analysis.restore(stored)
  analysis.plateText.value = held
  mount()
  await settle()
})

// --- Then ------------------------------------------------------------------

Then('the standards table reads tube {string} first at {int} ug\\/mL', (
  _world: World,
  tube: string,
  concentration: number,
) => {
  const [first] = standardRows()
  expect(first?.tube, 'the first tube in the standards table').toBe(tube)
  expect(first?.concentration, 'the first concentration in the standards table')
    .toBe(concentration)
})

Then('the standards table reads tube {string} last at {int} ug\\/mL', (
  _world: World,
  tube: string,
  concentration: number,
) => {
  const rows = standardRows()
  const last = rows[rows.length - 1]
  expect(last?.tube, 'the last tube in the standards table').toBe(tube)
  expect(last?.concentration, 'the last concentration in the standards table').toBe(concentration)
})

Then('the standards table lists the tubes in the order {string}, {string}, {string}', (
  _world: World,
  first: string,
  second: string,
  third: string,
) => {
  const tubes = standardRows().map((r) => r.tube)
  expect(tubes.slice(0, 3), 'the tube letters down the standards table')
    .toEqual([first, second, third])
})

Then('the page reports the standards direction as {string}', (
  _world: World,
  expected: string,
) => {
  // Read off the control, not the signal. The setting exists so that somebody can check which
  // way their plate was read without re-deriving the assay, and a signal that disagrees with the
  // control is exactly the state in which they cannot.
  const field = one('standards-direction') as HTMLSelectElement
  const shown = field.selectedOptions[0]?.textContent.trim() ?? ''
  expect(shown, 'the standards direction shown on the page').toBe(expected)
})

/**
 * The setting itself, for the one scenario that has no page left to read it off.
 *
 * Spelled as its own sentence rather than reusing the page one, so that a reader of the feature
 * can see which of the two is being claimed. The label is resolved through `directionLabel`, so
 * this and the control cannot drift into naming the same direction differently.
 */
Then('the standards direction setting is back to {string}', (
  _world: World,
  expected: string,
) => {
  expect(directionLabel(analysis.standardsDirection.value), 'the standards direction setting')
    .toBe(expected)
})

Then('the standards table still holds nine levels', () => {
  expect(standardRows(), 'the standards table lost or gained a level').toHaveLength(
    REFERENCE_ABSORBANCES.length,
  )
})

/**
 * Every absorbance on the row is still paired with some standard.
 *
 * Compared as a multiset against the plate row itself rather than against a written-out list, so
 * that a reversal which dropped one end and repeated the other — the way an off-by-one in a
 * reversal actually fails — cannot pass by having the right count.
 */
Then('every absorbance on the plate row is still accounted for', () => {
  const onThePlate = (analysis.plate.value.value.values[0] ?? [])
    .filter((cell): cell is number => cell !== null)
    .sort((a, b) => a - b)
  // Nulls are dropped from both sides, not just the plate's: a replicate that arrived as null is
  // an absorbance the curve did not get, so it shortens this list and the equality still fails.
  const inTheCurve = analysis.curve.value.value.levels
    .flatMap((l) => [...l.replicates])
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b)
  // Two standard rows are mapped, so each absorbance appears twice in the curve's levels.
  const expected = [...onThePlate, ...onThePlate].sort((a, b) => a - b)
  expect(inTheCurve, 'the absorbances the curve was fitted from').toEqual(expected)
})

Then('the plate row {string} is unchanged', (world: World, row: string) => {
  const index = row.trim().toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0)
  const now = analysis.plate.value.value.values[index]?.map((cell) => cell) ?? []
  expect(now, `plate row ${row} changed`).toEqual(world.beforeRowA)
})

Then("both samples' mean absorbances are unchanged", (world: World) => {
  const now = analysis.samples.value.value.map((r) => r.meanAbs)
  expect(now, 'the sample mean absorbances changed').toEqual(world.beforeMeanAbs)
})
