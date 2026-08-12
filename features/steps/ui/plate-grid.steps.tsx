/**
 * Steps for features/analysis/plate-grid.feature.
 *
 * Values are read out of the rendered inputs rather than off the signals, which is the opposite
 * of what the other browser step files do and is deliberate: this feature's whole subject is the
 * grid on screen. A scenario that read `plateText` would pass with no grid rendered at all.
 *
 * The exception is the storage claim, which is about a place rather than a pixel.
 */

import { expect } from 'vitest'
import { Given, Then, When } from 'quickpickle'
import { PLATE_COLUMNS, PLATE_ROWS } from '~/domain/constants'
import { referencePlateText } from '~/domain/reference'
import { loadPlateText } from '~/schemas/session'
import * as analysis from '~/state/analysis'
import { mount, mountOnce, one, settle, tabStore } from './support'
import { cleanup } from 'vitest-browser-preact'

/** The input for a well, as the person at the keyboard would find it. */
function wellInput(well: string): HTMLInputElement {
  const el = one(`well-${well}`)
  return el as HTMLInputElement
}

/** Every well input on the page, in reading order. */
function allWells(): HTMLInputElement[] {
  return PLATE_ROWS.flatMap((row) =>
    PLATE_COLUMNS.map((col) => wellInput(`${row}${col}`)),
  )
}

Given('the analysis page with an empty grid', async () => {
  analysis.reset()
  mountOnce()
  await settle()
})

When('well {string} is typed into with {string}', async (_w: unknown, well: string, entry: string) => {
  mountOnce()
  const input = wellInput(well)
  input.value = entry
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
})

Given('well {string} typed into with {string}', async (_w: unknown, well: string, entry: string) => {
  mountOnce()
  const input = wellInput(well)
  input.value = entry
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
})

When('the workbook\'s plate is pasted into the paste box', async () => {
  mountOnce()
  const box = one('plate-input') as HTMLTextAreaElement
  box.value = referencePlateText()
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
})

Given('the workbook\'s plate pasted into the paste box', async () => {
  mountOnce()
  const box = one('plate-input') as HTMLTextAreaElement
  box.value = referencePlateText()
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
})

When('the page is reloaded in the same tab', async () => {
  // A reload, as far as this app is concerned, is the module-level signals starting again from
  // whatever storage holds. Unmounting and re-reading through the real loader exercises that
  // path; assigning the value across would prove only that assignment works.
  cleanup()
  analysis.plateText.value = loadPlateText()
  mount()
  await settle()
})

When('the tab is closed and the app is opened again', async () => {
  // Closing the tab is what empties this store. The app then starts as it always does, by
  // asking the loader what is there — which is now nothing.
  cleanup()
  tabStore()?.clear()
  analysis.plateText.value = loadPlateText()
  mount()
  await settle()
})

Then('the grid shows {int} rows and {int} columns', (_w: unknown, rows: number, cols: number) => {
  const table = one('plate-grid')
  const bodyRows = [...table.querySelectorAll('tbody tr')]
  expect(bodyRows.length, 'rows in the grid').toBe(rows)
  for (const row of bodyRows) {
    expect(row.querySelectorAll('input').length, 'wells in a row').toBe(cols)
  }
})

Then('every well in the grid is empty', () => {
  const filled = allWells().filter((i) => i.value.trim() !== '')
  const named = filled.map((i) => i.getAttribute('data-testid')).join(', ')
  expect(filled.length, `these wells hold something: ${named}`).toBe(0)
})

Then('well {string} holds {float}', (_w: unknown, well: string, value: number) => {
  expect(Number(wellInput(well).value), `well ${well}`).toBeCloseTo(value, 10)
})

Then('well {string} reads {string}', (_w: unknown, well: string, shown: string) => {
  expect(wellInput(well).value, `well ${well} as displayed`).toBe(shown)
})

Then('well {string} is empty', (_w: unknown, well: string) => {
  expect(wellInput(well).value.trim(), `well ${well}`).toBe('')
})

Then('the page no longer states that a plate is needed to begin', () => {
  expect(document.querySelector('[data-testid="empty-state"]')).toBeNull()
})

/**
 * Whether the page says this well holds something it could not read.
 *
 * Read off the rendered issue panel, because a complaint nobody renders is not a complaint.
 * Deliberately narrower than "an issue names this well": a negative absorbance also names its
 * well, and it is a reading the app keeps and flags for checking rather than one it could not
 * read at all. Matching on the well alone would make those two indistinguishable, and the
 * scenario asserting the difference would pass either way.
 */
function unreadableComplaint(well: string): boolean {
  const panel = document.querySelector('[data-testid="issue-panel"]')
  const text = panel?.textContent ?? ''
  const sentences = text.split(/(?=well [A-H]\d)/)
  return sentences.some(
    (s) =>
      new RegExp(`\\b${well}\\b`).test(s) &&
      (/is not a number/.test(s) || /saturated/.test(s)),
  )
}

Then('well {string} is flagged as holding an unreadable entry', (_w: unknown, well: string) => {
  expect(unreadableComplaint(well), `the page said nothing unreadable about ${well}`).toBe(true)
})

Then('well {string} is not flagged as holding an unreadable entry', (_w: unknown, well: string) => {
  expect(unreadableComplaint(well), `the page called well ${well} unreadable`).toBe(false)
})

Then('well {string} is marked as holding no measurement', (_w: unknown, well: string) => {
  expect(wellInput(well).getAttribute('aria-invalid'), `well ${well}`).toBe('true')
})

Then('no absorbance is found in storage that outlives the tab', () => {
  // localStorage is the store that survives the tab. The promise is about that one; the plate
  // lives in sessionStorage, which the previous step has just emptied.
  const surviving = (globalThis as { localStorage?: Storage }).localStorage
  const dump = Object.keys(surviving ?? {})
    .map((k) => surviving?.getItem(k) ?? '')
    .join(' ')
  for (const reading of ['0.430', '0.132', '2.051']) {
    expect(dump, `an absorbance reached storage that outlives the tab`).not.toContain(reading)
  }
})
