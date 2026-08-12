/**
 * Steps for features/analysis/plate-layout-painting.feature.
 *
 * Assignments are read off the rendered grid, not off `sampleAssignments`. The signal is what
 * the app computes; the label under the well is what a researcher acts on, and AC3 is a claim
 * about the second. A step reading the signal would pass with the labels never drawn.
 */

import { expect } from 'vitest'
import { Given, Then, When } from 'quickpickle'
import {
  ANALYSIS_STANDARD_CONCENTRATIONS,
  PLATE_COLUMNS,
  PLATE_ROWS,
} from '~/domain/constants'
import { parseRegion } from '~/domain/layout'
import { referencePlateText } from '~/domain/reference'
import * as analysis from '~/state/analysis'
import { mountOnce, one, settle } from './support'

/** What the grid says this well holds, as the word shown under it. */
function shownAssignment(well: string): string {
  return one(`assignment-${well}`).textContent.trim()
}

const wellsIn = (region: string): string[] => parseRegion(region).wells

function selectPaint(testId: string): void {
  mountOnce()
  one(`paint-${testId}`).click()
}

Given("the workbook's plate pasted into the grid", async () => {
  analysis.reset()
  analysis.sampleNames.value = ['MCF7', 'RPMI8226']
  analysis.pasteGrid(referencePlateText())
  mountOnce()
  await settle()
})

Given('the workbook\'s plate with well {string} holding no measurement', async (
  _w: unknown, well: string,
) => {
  analysis.reset()
  analysis.sampleNames.value = ['MCF7', 'RPMI8226']
  analysis.pasteGrid(referencePlateText())
  analysis.typeIntoWell(well, '')
  mountOnce()
  await settle()
})

Given('{string} is the selected name', async (_w: unknown, name: string) => {
  selectPaint(`sample-${name}`)
  await settle()
})

Given('the erase entry is the selected name', async () => {
  selectPaint('erase')
  await settle()
})

Given('wells {string} assigned to {string}', async (_w: unknown, region: string, name: string) => {
  mountOnce()
  analysis.painting.value = { kind: 'sample', name }
  analysis.paintWells(wellsIn(region))
  analysis.painting.value = { kind: 'off' }
  await settle()
})

Given('the grid focused with the cursor on well {string}', async (_w: unknown, well: string) => {
  mountOnce()
  ;(one(`well-${well}`) as HTMLInputElement).focus()
  await settle()
})

When('wells {string}, {string} and {string} are painted', async (
  _w: unknown, a: string, b: string, c: string,
) => {
  mountOnce()
  for (const well of [a, b, c]) one(`well-${well}`).click()
  await settle()
})

When('wells {string} is painted', async (_w: unknown, well: string) => {
  mountOnce()
  one(`well-${well}`).click()
  await settle()
})

When('wells {string} are painted as {string}', async (
  _w: unknown, region: string, name: string,
) => {
  selectPaint(`sample-${name}`)
  // The settle here is load-bearing, not politeness. Arming the palette is a signal write, and
  // the wells' click handlers are closures created at render: without a render in between, they
  // still hold the previous value of `armed` and every click below is ignored. This step failed
  // exactly that way, and looked for all the world like painting being broken.
  await settle()
  for (const well of wellsIn(region)) one(`well-${well}`).click()
  await settle()
})

When('the paint key is pressed', async () => {
  const active = document.activeElement as HTMLElement | null
  active?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
})

When('a different plate is pasted into the paste box', async () => {
  mountOnce()
  const box = one('plate-input') as HTMLTextAreaElement
  box.value = referencePlateText().replace('0.132', '0.140')
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
})

Then('wells {string} are assigned to the standards', (_w: unknown, region: string) => {
  for (const well of wellsIn(region)) {
    expect(shownAssignment(well), `well ${well}`).toBe('std')
  }
})

Then('wells {string} are assigned to {string}', (_w: unknown, region: string, name: string) => {
  for (const well of wellsIn(region)) {
    expect(shownAssignment(well), `well ${well}`).toBe(name)
  }
})

Then('no well is assigned to a sample', () => {
  const painted = PLATE_ROWS.flatMap((row) =>
    PLATE_COLUMNS.map((col) => `${row}${col}`),
  ).filter((well) => {
    const held = shownAssignment(well)
    return held !== '' && held !== 'std'
  })
  expect(painted.join(', '), 'wells still assigned to a sample').toBe('')
})

Then('well {string} is assigned to nothing', (_w: unknown, well: string) => {
  expect(shownAssignment(well), `well ${well}`).toBe('')
})

Then('well {string} shows the text {string}', (_w: unknown, well: string, text: string) => {
  expect(shownAssignment(well), `well ${well}`).toBe(text)
})

Then('well {string} shows the text for the standards', (_w: unknown, well: string) => {
  expect(shownAssignment(well), `well ${well}`).toBe('std')
})

Then('the assignment of well {string} is legible with every colour removed', (
  _w: unknown, well: string,
) => {
  // The label is text in the document, so it survives greyscale, forced colours and a screen
  // reader by construction. What would defeat that is a label rendered but invisible, which is
  // what this checks: it has to have words in it and not be hidden.
  const label = one(`assignment-${well}`)
  expect(label.textContent.trim(), `well ${well} label`).not.toBe('')
  expect(getComputedStyle(label).display, `well ${well} label`).not.toBe('none')
  expect(getComputedStyle(label).visibility, `well ${well} label`).not.toBe('hidden')
})

Then('every well in the grid can be reached in turn from the keyboard', () => {
  const unreachable = PLATE_ROWS.flatMap((row) => PLATE_COLUMNS.map((col) => `${row}${col}`))
    .filter((well) => {
      const el = one(`well-${well}`) as HTMLInputElement
      el.focus()
      return document.activeElement !== el
    })
  expect(unreachable.join(', '), 'wells the keyboard cannot reach').toBe('')
})

Then('the standards carry the lab series in plate order', () => {
  // A level holds no well reference, so "plate order" is asserted where it lands: the nth well
  // of each painted row is the nth concentration, which makes the levels the series in order.
  const levels = analysis.curve.value.value.levels
  expect(levels.map((l) => l.concUgPerML), 'the concentrations the curve was fitted on').toEqual([
    ...ANALYSIS_STANDARD_CONCENTRATIONS,
  ])
})

Then('the standards are read as {int} replicates of {int}', (
  _w: unknown, reps: number, per: number,
) => {
  // Two painted rows are two reads of the series, not one series of eighteen. This is the claim
  // that regionsByRow exists to keep true.
  const levels = analysis.curve.value.value.levels
  expect(levels.length, 'levels in the series').toBe(per)
  for (const level of levels) {
    expect(level.replicates.length, `replicates of ${level.concUgPerML} ug/mL`).toBe(reps)
  }
})

Then('no issue is raised about a well outside an assignment', () => {
  // Every unassigned well on the plate, not a spot check of five. An earlier version of this
  // step named E1, F1, G1, H1 and D12 and passed while the page was listing A10, A11, A12, B10,
  // B11 and B12 by name in a plate-wide note — the exact behaviour AC5 forbids. A five-well
  // sample of ninety-six is not a check, it is a coincidence.
  const panel = document.querySelector('[data-testid="issue-panel"]')
  const text = panel?.textContent ?? ''
  const assigned = analysis.assignmentOf.value
  const named = PLATE_ROWS.flatMap((row) => PLATE_COLUMNS.map((col) => `${row}${col}`))
    .filter((well) => !assigned.has(well))
    // Word boundaries so that A1 is not found inside A10, which would report a failure that
    // is not there and hide the one that is.
    .filter((well) => new RegExp(`\\b${well}\\b`).test(text))
  expect(named.join(', '), 'unassigned wells the page complained about').toBe('')
})

Then('{string} reports a concentration from {int} wells', (
  _w: unknown, name: string, n: number,
) => {
  const found = analysis.samples.value.value.find((s) => s.name === name)
  expect(found, `no result for ${name}`).toBeDefined()
  expect(found?.n, `${name} replicate count`).toBe(n)
})

Then('an issue at warn severity names well {string}', (_w: unknown, well: string) => {
  const panel = document.querySelector('[data-testid="issue-panel"]')
  expect(panel?.textContent ?? '', `nothing was said about well ${well}`).toContain(well)
})

Then('an issue says {string} was averaged over {int} of its {int} wells', (
  _w: unknown, name: string, measured: number, total: number,
) => {
  // Asserted as the whole sentence rather than as "the panel mentions MCF7 somewhere". The
  // panel mentions MCF7 in the samples table too, so the loose version would pass with this
  // issue never raised — which is the failure mode this scenario exists to catch.
  const panel = document.querySelector('[data-testid="issue-panel"]')
  expect(panel?.textContent ?? '', 'the shortfall was not reported').toContain(
    `${name} is averaged over ${measured} of its ${total} wells`,
  )
})

/**
 * Type into the sample-names field one character at a time, firing `input` for each.
 *
 * Not `field.value = 'MCF7, RPMI8226'` followed by one event. The defect this scenario exists
 * for lives strictly between keystrokes: the field was controlled from the parsed list, so the
 * moment the comma was typed the trailing empty name was filtered away and the box redrawn
 * without it. Setting the whole string at once arrives at a state where every name is non-empty
 * and passes over the very keystroke that fails.
 *
 * Typed onto whatever is in the box rather than from empty, because that is also what a person
 * does, and it is what makes the re-render visible: if the value the app writes back disagrees
 * with what was typed, the next character is appended to the app's version and the assertion
 * sees the damage.
 */
When('{string} is typed into the sample names field', async (_w: unknown, text: string) => {
  mountOnce()
  const field = one('sample-names') as HTMLInputElement
  field.value = ''
  for (const char of text) {
    field.value += char
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
  }
  await settle()
})

Then('the sample names field still reads {string}', (_w: unknown, expected: string) => {
  const field = one('sample-names') as HTMLInputElement
  expect(field.value, 'what the box holds after typing').toBe(expected)
})

Then('the palette offers {string} and {string}', (_w: unknown, first: string, second: string) => {
  // Read off the rendered palette rather than off sampleNames, because AC8 is about being able
  // to select a second sample to paint with. A signal holding two names and a palette drawing
  // one would satisfy the signal-level check and still leave the sample unpaintable.
  const offered = [...document.querySelectorAll('[data-testid^="paint-sample-"]')].map((b) =>
    b.textContent.trim(),
  )
  expect(offered, 'the names the palette offers to paint with').toEqual([first, second])
})
