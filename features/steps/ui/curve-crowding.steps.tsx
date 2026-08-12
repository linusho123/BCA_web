/**
 * Proves features/analysis/curve-plot-crowding.feature.
 *
 * The Background sentence is shared with curve-plot-presentation.feature and is registered once,
 * in curve-plot.steps.tsx; QuickPickle's registry is per setup file, so re-registering it here
 * would be a duplicate rather than an override.
 *
 * These steps drive the pointer by coordinate rather than by element. `userEvent.hover(element)`
 * aims at the element's own centre, which is exactly the aiming a reader cannot do — they aim at
 * what they see, and where two marks overlap what they see is one mark's centre sitting inside
 * the other's box. Dispatching at the coordinate is what asks the chart the question the feature
 * asks: given a pointer here, which standard do you say this is.
 */

import { expect } from 'vitest'
import { Then, When } from 'quickpickle'
import * as analysis from '~/state/analysis'
import { readoutText } from '~/ui/chart/CurveChart'
import { markLabelled, one, settle, textOf } from './support'

/** Where a mark is centred on screen. The marks are centred on their position, not cornered at it. */
function centreOf(el: HTMLElement): { x: number; y: number } {
  const box = el.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

/**
 * Point at a mark's centre without naming the mark to the browser.
 *
 * Events are dispatched at the coordinate on whatever element is topmost there, which is the
 * whole point: if the chart resolves a pointer by which box caught the event, the covering mark
 * answers and the step fails. `userEvent.hover` cannot express this — it targets an element and
 * would route the event to the mark we asked for even when a reader's pointer could never reach
 * it.
 */
async function pointAt(el: HTMLElement, kind: 'pointer' | 'click'): Promise<void> {
  // The chart sits well below the fold, and `elementFromPoint` is viewport-relative: without
  // this it answers null for every mark, the step falls back to the element it was handed, and
  // the overlap these scenarios exist to pin is never exercised at all.
  el.scrollIntoView({ block: 'center' })
  await settle()

  const { x, y } = centreOf(el)
  const topmost = document.elementFromPoint(x, y)
  if (topmost === null) {
    throw new Error(`standard ${el.getAttribute('data-label')} is not at a point on screen`)
  }
  const init = { clientX: x, clientY: y, bubbles: true, cancelable: true } as const

  // The order a browser fires these in when a pointer arrives somewhere: the topmost element
  // gets the enter, and `mouseenter` does not bubble, which is exactly why a covering mark can
  // answer for the one underneath it.
  topmost.dispatchEvent(new MouseEvent('mouseover', init))
  topmost.dispatchEvent(new MouseEvent('mouseenter', { ...init, bubbles: false }))
  topmost.dispatchEvent(new MouseEvent('mousemove', init))
  if (kind === 'click') {
    topmost.dispatchEvent(new MouseEvent('mousedown', init))
    topmost.dispatchEvent(new MouseEvent('mouseup', init))
    topmost.dispatchEvent(new MouseEvent('click', init))
  }
  await settle()
}

When(/^standard "(.+)" is (pointed at|clicked)$/, async (_world, tube: string, route: string) => {
  await pointAt(markLabelled(tube), route === 'clicked' ? 'click' : 'pointer')
})

Then('the readout names standard {string}', (_world, tube: string) => {
  const point = analysis.plot.value.points.find((p) => p.label === tube)
  if (!point) throw new Error(`the plot holds no point labelled "${tube}"`)
  expect(
    textOf(one('curve-readout')),
    `pointing at standard ${tube} did not read standard ${tube} back`,
  ).toBe(readoutText(point))
})

/**
 * The precondition the rule exists for.
 *
 * Asserted as a real geometric overlap of the two hit areas rather than as a pixel distance, so
 * it keeps meaning the same thing if either the mark size or the chart width changes.
 */
Then('the marks for standards {string} and {string} overlap each other', (_world, a: string, b: string) => {
  const first = markLabelled(a).getBoundingClientRect()
  const second = markLabelled(b).getBoundingClientRect()
  const overlaps =
    first.left < second.right &&
    second.left < first.right &&
    first.top < second.bottom &&
    second.top < first.bottom
  expect(
    overlaps,
    `standards ${a} and ${b} no longer overlap, so this feature is pinning a situation that ` +
      `cannot arise; check the geometry before deleting it`,
  ).toBe(true)
})

