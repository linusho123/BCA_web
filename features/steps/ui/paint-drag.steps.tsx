/**
 * Steps for features/analysis/plate-paint-drag.feature.
 *
 * A drag is dispatched as the pointer events a real drag produces, in the order a real pointer
 * produces them, rather than as a call to whatever the grid happens to expose. That is the whole
 * value of these scenarios: the defect they exist for was not a wrong assignment, it was a
 * gesture that reached no handler at all, and only a step that plays the gesture can see that.
 *
 * Assignments are read through painting.steps.tsx's `shownAssignment`, off the rendered label —
 * same reason as there, and it matters more here, since a drag that updated the signal without
 * redrawing is exactly the sort of thing a pointer-driven path gets wrong.
 */

import { Given, Then, When } from 'quickpickle'
import { expect } from 'vitest'
import { parseRegion } from '~/domain/layout'
import * as analysis from '~/state/analysis'
import { mountOnce, one, settle } from './support'

const wellsIn = (region: string): string[] => parseRegion(region).wells

/**
 * A pointer event of the kind a mouse produces.
 *
 * `buttons` is the load-bearing field and the reason these are not plain `Event`s: it is how a
 * pointer moving with the button down is told apart from one merely passing over, and the grid
 * is required to tell them apart. `pointerenter` does not bubble in any browser, so it is
 * dispatched on the well itself — which is also where a real one would land.
 */
function pointer(type: string, buttons: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: type !== 'pointerenter' && type !== 'pointerleave',
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: type === 'pointerup' ? 0 : buttons === 0 ? -1 : 0,
    buttons,
  })
}

const wellEl = (well: string): HTMLElement => one(`well-${well}`)

/**
 * Press on the first well, cross the rest, release on the last.
 *
 * The hover before the press is not decoration. A real pointer enters the well with no button
 * held and only then goes down, so a grid that painted on any `pointerenter` would paint a well
 * the moment the mouse passed over it — and without this first event, the step would never
 * notice. It is the same reason the release is a real `pointerup` rather than the drag simply
 * ending: an unfinished gesture leaves state behind, and the next scenario would inherit it.
 */
async function drag(wells: readonly string[]): Promise<void> {
  mountOnce()
  const [first, ...rest] = wells
  if (first === undefined) throw new Error('a drag needs at least one well')

  wellEl(first).dispatchEvent(pointer('pointerenter', 0))
  wellEl(first).dispatchEvent(pointer('pointerdown', 1))
  await settle()

  for (const well of rest) {
    wellEl(well).dispatchEvent(pointer('pointerenter', 1))
    await settle()
  }

  wellEl(wells[wells.length - 1] as string).dispatchEvent(pointer('pointerup', 0))
  await settle()
}

Given('the palette left on typing values', async () => {
  mountOnce()
  one('paint-off').click()
  // Load-bearing, for the reason painting.steps.tsx records at length: the wells' handlers are
  // closures made at render, so without a render here they would still hold the previous arming.
  await settle()
})

When('wells {string} are painted with one drag', async (_w: unknown, region: string) => {
  await drag(wellsIn(region))
})

When('wells {string}, {string} and {string} are painted with one drag', async (
  _w: unknown, a: string, b: string, c: string,
) => {
  // Exactly these three wells are entered, with nothing in between. The scenario's premise is a
  // pointer steered around a bad well — dipped below the row and back up — so the well between
  // b and c is one the pointer never entered, not one it crossed and the grid declined to paint.
  await drag([a, b, c])
})

/**
 * A gesture that begins on a well and is let go where nothing tells the page about it.
 *
 * No `pointerup` is dispatched at all, and that is the point: a button released after the pointer
 * has left the window — over the desktop, over another application — delivers no event here.
 * Listening for the release on the document would pass this step and still leave the real gesture
 * armed, so what has to end the drag is the thing that is delivered: a pointer that comes back
 * with `buttons` at 0, which is the browser reporting the state rather than the transition.
 */
Given('a drag started on well {string} and let go where the page never heard it', async (
  _w: unknown, well: string,
) => {
  mountOnce()
  wellEl(well).dispatchEvent(pointer('pointerenter', 0))
  wellEl(well).dispatchEvent(pointer('pointerdown', 1))
  await settle()
})

When('the pointer passes back over wells {string} with no button held', async (
  _w: unknown, region: string,
) => {
  mountOnce()
  for (const well of wellsIn(region)) {
    wellEl(well).dispatchEvent(pointer('pointerenter', 0))
    await settle()
  }
})

/**
 * A press that lands off the grid and then sweeps across it — selecting a paragraph, or grabbing
 * a scrollbar and overshooting. Every event a painting drag would produce is dispatched except
 * the one that matters: the `pointerdown` happens on the body, so no well ever saw the press.
 */
When('a drag begun off the grid sweeps across wells {string}', async (
  _w: unknown, region: string,
) => {
  mountOnce()
  document.body.dispatchEvent(pointer('pointerdown', 1))
  await settle()
  const wells = wellsIn(region)
  for (const well of wells) {
    wellEl(well).dispatchEvent(pointer('pointerenter', 1))
    await settle()
  }
  wellEl(wells[wells.length - 1] as string).dispatchEvent(pointer('pointerup', 0))
  await settle()
})

/**
 * The standards as the curve actually consumed them, not as labels under the wells.
 *
 * The labels are checked by the step beside this one, and they would survive the failure this
 * step is for: a drag that reached the paint path while disarmed takes each well it crossed off
 * the standards and puts it nowhere, and `regionsByRow` then rebuilds row A from six wells
 * rather than nine. The row still reads "std" everywhere it still exists, and the curve is
 * quietly fitted from a shorter series.
 */
Then('the standards are still read as {int} replicates of {int}', (
  _w: unknown, reps: number, per: number,
) => {
  const levels = analysis.curve.value.value.levels
  expect(levels.length, 'levels in the series').toBe(per)
  for (const level of levels) {
    expect(level.replicates.length, `replicates of ${level.concUgPerML} ug/mL`).toBe(reps)
  }
})
