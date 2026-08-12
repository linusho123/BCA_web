/**
 * Proves features/analysis/curve-plot-presentation.feature.
 *
 * The chart has two halves and each claim belongs to exactly one of them. What the canvas draws —
 * which shapes, which series, whether a label is shown, whether anything animates — is asserted
 * against the option the component actually passed to ECharts, because a canvas has no DOM to
 * query and re-deriving the option here would only prove this file agrees with itself. What the
 * reader reaches — focus, hover, the readout, the escaped name, the empty state — is asserted
 * against the rendered tree, because that is where those live.
 *
 * The option comes from `chartOption` in the component rather than from `curveOption` in the
 * builder, so the motion preference is included the way the chart included it.
 */

import { expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { Given, Then, When } from 'quickpickle'
import type { EChartsOption } from 'echarts'
import { fixed, grouped } from '~/domain/format'
import type { PlotPoint } from '~/domain/plot'
import { referencePlateText } from '~/domain/reference'
import * as analysis from '~/state/analysis'
import { chartOption, readoutText } from '~/ui/chart/CurveChart'
import {
  SERIES_SAMPLES,
  SERIES_STANDARDS,
  curveOption,
} from '~/ui/chart/curveOption'
import type { World } from '../../support/world'
import {
  SAMPLE_NAMES,
  exists,
  markLabelled,
  marks,
  mount,
  one,
  plateOf,
  plateRow,
  plateWithSamples,
  rowLabels,
  sampleNamesFor,
  settle,
  stubReducedMotion,
  textOf,
} from './support'

/**
 * The 500 µg/mL standard is tube E in the reference series — see ANALYSIS_STANDARD_TUBES.
 *
 * Mid-curve on purpose. The low standards sit close enough together that their marks overlap,
 * and a pointer aimed at one of those cannot be routed to it by element at all — which is a
 * claim about crowding, proved in curve-plot-crowding.feature, not about the readout.
 */
const MID_STANDARD = 'E'

/** An absorbance past the top standard (2.051), so the sample plots outside the calibrated range. */
const ABOVE_EVERY_STANDARD = 2.4

/**
 * Just enough of an ECharts scatter series to ask it the questions this feature asks.
 *
 * ECharts types `series` as a union of every series type it ships, so reading `symbol` off it
 * needs a narrowing that says something about echarts rather than about the chart. This says what
 * the option builder puts there and nothing else.
 */
interface DrawnSeries {
  readonly name?: string
  readonly symbol?: string
  readonly label?: { readonly show?: boolean }
  readonly data?: ReadonlyArray<{
    readonly name?: string
    readonly value?: unknown
    readonly itemStyle?: { readonly color?: string }
  }>
}

/** The option the chart is drawing right now. */
function drawnOption(): EChartsOption {
  return chartOption(analysis.plot.value)
}

function seriesNamed(option: EChartsOption, name: string): DrawnSeries {
  const drawn = (option.series ?? []) as readonly DrawnSeries[]
  const found = drawn.find((s) => s.name === name)
  if (!found) {
    const names = drawn.map((s) => s.name ?? '(unnamed)').join(', ') || 'none'
    throw new Error(`the chart drew no series named "${name}"; it drew: ${names}`)
  }
  return found
}

/** The point the plot gave a label, so a Then can quote the same numbers the chart used. */
function pointLabelled(label: string): PlotPoint {
  const found = analysis.plot.value.points.find((p) => p.label === label)
  if (!found) {
    const drawn = analysis.plot.value.points.map((p) => p.label).join(', ') || 'none'
    throw new Error(`the plot holds no point labelled "${label}"; it holds: ${drawn}`)
  }
  return found
}

/**
 * Wait until the mark layer has caught up with the plot.
 *
 * The buttons are positioned from `convertToPixel`, which only answers once ECharts has laid the
 * canvas out — so a step that queried immediately after mounting would find no marks and report
 * an accessibility failure that is really a timing one.
 *
 * Counting is not enough on its own. A point `convertToPixel` cannot place yet is rendered at
 * the off-canvas sentinel rather than dropped, so it is present in the count while being nowhere
 * a pointer could reach it — and the steps that ask the browser for real geometry would then be
 * measuring a mark parked off-screen. Waiting for the marks to be *placed* as well as present
 * closes that gap. Whether it was ever open in a real run is unproven; see the flake section in
 * features/README.md.
 */
async function drawn(): Promise<void> {
  const plot = analysis.plot.value
  const expected = plot.plottable ? plot.points.length : 0
  for (let i = 0; i < 60; i++) {
    if (marks().length === expected && marks().every(placed)) return
    await settle()
  }
}

/** Whether a mark has a real position rather than the off-canvas sentinel. */
function placed(mark: HTMLElement): boolean {
  return !mark.style.left.startsWith('-9999') && !mark.style.top.startsWith('-9999')
}

// --- keyboard ---------------------------------------------------------------

const FOCUSABLE = 'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])'

/** How many tabs it can take to cycle the page once. */
function tabBudget(): number {
  return document.querySelectorAll(FOCUSABLE).length + 2
}

/** Start a tab sequence from the top of the document rather than from wherever focus was left. */
function releaseFocus(): void {
  const active = document.activeElement
  if (active instanceof HTMLElement) active.blur()
}

/**
 * Move the pointer off the chart before making a claim about the keyboard.
 *
 * `userEvent.hover` moves the real cursor and leaves it there. A later scenario that re-renders
 * the chart puts a fresh mark under that stationary cursor, Chromium fires `mouseenter` on it,
 * and the readout answers the mouse while the scenario is asking about focus. Both inputs driving
 * the readout is the feature working as specified — so the scenario has to stop using one of them
 * before it can attribute the answer to the other.
 */
async function parkPointer(): Promise<void> {
  await userEvent.hover(one('plate-input'))
  await settle()
}

/**
 * Tab until something matches, or give up after one full cycle of the page.
 *
 * Tabbed rather than focused programmatically, because the claim is that the point is *in the tab
 * order* — and `.focus()` succeeds on elements a keyboard user can never reach.
 */
async function tabUntil(match: (el: Element | null) => boolean): Promise<boolean> {
  const budget = tabBudget()
  for (let i = 0; i < budget; i++) {
    await userEvent.keyboard('{Tab}')
    if (match(document.activeElement)) return true
  }
  return false
}

// --- Given ------------------------------------------------------------------

Given('the analysis page showing the reference curve', async () => {
  analysis.plateText.value = referencePlateText()
  mount()
  analysis.applyDefaultLayout([...SAMPLE_NAMES])
  await drawn()
})

Given('{int} analysed samples', async (_world: World, n: number) => {
  // One row of three replicates per sample, spread across the absorbance range so no two marks
  // land on the same pixel and hide each other.
  const absorbances = Array.from({ length: n }, (_, i) => 0.3 + i * 0.12)
  analysis.plateText.value = plateWithSamples(absorbances)
  mount()
  analysis.applyDefaultLayout(sampleNamesFor(n))
  await drawn()
})

Given('a sample reading above every standard', async () => {
  analysis.plateText.value = plateWithSamples([ABOVE_EVERY_STANDARD])
  mount()
  analysis.applyDefaultLayout(['Overrange'])
  await drawn()
})

Given('the reader prefers reduced motion', async () => {
  stubReducedMotion(true)
  await settle()
})

Given('a curve fit that produced no coefficients', async () => {
  // Nine standards at one absorbance: the design matrix has rank one against a cubic's four
  // columns, so the fit is singular and the plot has no path to draw.
  const flat = plateRow(Array<number>(9).fill(0.5))
  analysis.plateText.value = plateOf([flat, flat, plateRow([0.43, 0.43, 0.43])])
  mount()
  analysis.applyDefaultLayout(['MCF7'])
  await drawn()
})

Given('a sample named {string}', async (world: World, name: string) => {
  analysis.plateText.value = plateWithSamples([0.43])
  mount()
  analysis.applyDefaultLayout([name])
  await drawn()
  world.sampleName = name
})

Given('the 500 ug\\/mL standard is focused', async (world: World) => {
  releaseFocus()
  const reached = await tabUntil(
    (el) => el instanceof HTMLElement && el.getAttribute('data-label') === MID_STANDARD,
  )
  expect(reached, `tabbing never reached the ${MID_STANDARD} standard`).toBe(true)
  await settle()
  world.focusedPoint = pointLabelled(MID_STANDARD)
})

// --- When -------------------------------------------------------------------

/**
 * Re-render, rather than assume the Background's chart is still the right one.
 *
 * Several scenarios change what the chart should look like in their Given — the motion preference,
 * the number of samples — and a When that only settled would be asserting against the chart drawn
 * before the Given ran.
 */
When('the chart is rendered', async () => {
  mount()
  await drawn()
})

When(/^the 500 ug\/mL standard is reached by (.+)$/, async (world: World, route: string) => {
  const mark = markLabelled(MID_STANDARD)

  if (route === 'pointer hover') {
    await userEvent.hover(mark)
  } else if (route === 'click') {
    await userEvent.click(mark)
  } else if (route === 'keyboard focus') {
    releaseFocus()
    const reached = await tabUntil(
      (el) => el instanceof HTMLElement && el.getAttribute('data-label') === MID_STANDARD,
    )
    expect(reached, `tabbing never reached the ${MID_STANDARD} standard`).toBe(true)
  } else {
    throw new Error(`"${route}" is not a route this chart offers`)
  }

  await settle()
  world.reachedPoint = pointLabelled(MID_STANDARD)
})

When('focus leaves the chart', async () => {
  await userEvent.click(document.body)
  await settle()
})

// --- Then: what the canvas draws --------------------------------------------

Then('the standard marks and the sample marks use different shapes', () => {
  const option = drawnOption()
  const standards = seriesNamed(option, SERIES_STANDARDS)
  const samples = seriesNamed(option, SERIES_SAMPLES)

  expect(standards.symbol, 'the standards series names no shape').toBeTruthy()
  expect(samples.symbol, 'the samples series names no shape').toBeTruthy()
  expect(
    samples.symbol,
    'standards and samples are drawn in the same shape, so only colour tells them apart',
  ).not.toBe(standards.symbol)
})

Then('the legend names the standards and the samples', () => {
  const legend = drawnOption().legend as { data?: readonly string[] } | undefined
  const named = legend?.data ?? []
  expect(named, 'the legend does not name the standards').toContain(SERIES_STANDARDS)
  expect(named, 'the legend does not name the samples').toContain(SERIES_SAMPLES)
})

Then('{int} sample marks carry a direct label', (_world: World, expected: number) => {
  const samples = seriesNamed(drawnOption(), SERIES_SAMPLES)
  // The label switch is per-series: either every sample mark carries its name or none does.
  const labelled = samples.label?.show === true ? (samples.data ?? []).length : 0
  expect(labelled, `${expected} sample marks should carry a direct label`).toBe(expected)
})

Then('the concentration axis reads {string} rather than {string}', (
  _world: World,
  grouped_: string,
  plain: string,
) => {
  const axis = drawnOption().yAxis as
    | { axisLabel?: { formatter?: (value: number) => string } }
    | undefined
  const format = axis?.axisLabel?.formatter
  expect(format, 'the concentration axis formats its labels however ECharts likes').toBeTypeOf(
    'function',
  )

  const written = format?.(Number(plain.replace(/,/g, '')))
  expect(written, `the axis wrote "${written}" rather than "${grouped_}"`).toBe(grouped_)
})

Then("that sample's mark is drawn hollow", () => {
  const samples = seriesNamed(drawnOption(), SERIES_SAMPLES)
  const drawnPoints = samples.data ?? []
  expect(drawnPoints.length, 'no sample was plotted at all').toBeGreaterThan(0)

  const outside = analysis.plot.value.points.filter((p) => p.kind === 'sample' && !p.inRange)
  expect(outside.length, 'the sample was plotted as if it were in range').toBeGreaterThan(0)

  for (const point of outside) {
    const mark = drawnPoints.find((d) => d.name === point.label)
    expect(mark, `"${point.label}" was not drawn`).toBeDefined()
    // Hollow rather than a different hue: fill survives greyscale and colourblindness alike.
    expect(mark?.itemStyle?.color, `"${point.label}" was drawn filled`).toBe('transparent')
  }
})

// --- Then: reduced motion ---------------------------------------------------

Then('no mark is animated', () => {
  expect(drawnOption().animation, 'the chart animated despite the reader asking it not to').toBe(
    false,
  )
})

Then('the chart shows the same points and the same readout', async () => {
  const plot = analysis.plot.value
  const motionless = drawnOption()
  const animated = curveOption(plot, { animate: true })

  // Compared series by series against the same chart with motion on: reduced motion is allowed to
  // remove the animation and nothing else, so every point must survive it unchanged.
  const data = (option: EChartsOption) =>
    ((option.series ?? []) as readonly DrawnSeries[]).map((s) => [s.name, s.data])
  expect(data(motionless), 'reduced motion changed what the chart plots').toEqual(data(animated))

  expect(marks().length, 'reduced motion changed how many points can be reached').toBe(
    plot.points.length,
  )

  const point = pointLabelled(MID_STANDARD)
  await userEvent.click(markLabelled(MID_STANDARD))
  await settle()
  expect(textOf(one('curve-readout')), 'reduced motion changed what the readout says').toBe(
    readoutText(point),
  )
})

// --- Then: the readout ------------------------------------------------------

Then('the readout names that standard', (world: World) => {
  const point = world.reachedPoint as PlotPoint | undefined
  expect(point, 'no step reached a point before this one').toBeDefined()
  expect(textOf(one('curve-readout')), 'the readout does not name the standard').toContain(
    `Standard ${point?.label ?? ''}`,
  )
})

Then('the readout states its absorbance and its concentration', (world: World) => {
  const point = world.reachedPoint as PlotPoint | undefined
  expect(point, 'no step reached a point before this one').toBeDefined()
  const said = textOf(one('curve-readout'))

  expect(said, 'the readout omits the absorbance').toContain(fixed(point?.absorbance ?? 0, 4))
  expect(said, 'the readout omits the concentration').toContain(
    grouped(point?.concUgPerML ?? 0, 1),
  )
})

Then('the readout no longer names that standard', (world: World) => {
  const point = world.focusedPoint as PlotPoint | undefined
  expect(point, 'no step focused a point before this one').toBeDefined()
  const said = textOf(one('curve-readout'))
  expect(said, 'the readout froze on the point focus had left').not.toContain(
    `Standard ${point?.label ?? ''}`,
  )
})

// --- Then: the keyboard -----------------------------------------------------

Then('every plotted point is focusable in turn', async () => {
  const plot = analysis.plot.value
  expect(marks().length, 'the chart drew no mark layer to tab through').toBe(plot.points.length)

  await parkPointer()
  releaseFocus()
  const reached = new Set<string>()
  const budget = tabBudget()
  for (let i = 0; i < budget; i++) {
    await userEvent.keyboard('{Tab}')
    const label = document.activeElement?.getAttribute('data-label')
    if (label !== null && label !== undefined) reached.add(label)
  }

  const missed = plot.points.map((p) => p.label).filter((label) => !reached.has(label))
  expect(missed, 'these points cannot be reached with the keyboard').toEqual([])
})

Then('each focused point announces its label to assistive technology', async () => {
  await parkPointer()
  const readout = one('curve-readout')
  expect(
    readout.getAttribute('aria-live'),
    'the readout changes silently, so a reader tabbing across the points hears nothing',
  ).toBe('polite')

  for (const point of analysis.plot.value.points) {
    const mark = markLabelled(point.label)
    expect(mark.getAttribute('aria-label'), `"${point.label}" has no accessible name`).toBe(
      readoutText(point),
    )

    mark.focus()
    await settle()
    expect(textOf(one('curve-readout')), `focusing "${point.label}" announced nothing`).toBe(
      readoutText(point),
    )
  }
})

// --- Then: the table beside it ----------------------------------------------

Then('the standards table is shown alongside it', () => {
  expect(exists('curve-chart'), 'the chart is not drawn').toBe(true)
  expect(exists('standards-table'), 'the chart is the only view of these numbers').toBe(true)
})

Then('each plotted standard has a row in that table', () => {
  const rows = rowLabels('standards-table')
  const plotted = analysis.plot.value.points.filter((p) => p.kind === 'standard')
  expect(plotted.length, 'no standard was plotted').toBeGreaterThan(0)

  const missing = plotted.map((p) => p.label).filter((label) => !rows.includes(label))
  expect(missing, 'these standards appear in the chart but in no table row').toEqual([])
})

// --- Then: the empty state --------------------------------------------------

Then('the chart area states why there is nothing to plot', () => {
  expect(exists('curve-chart'), 'an unfittable curve still drew a chart frame').toBe(false)
  expect(textOf(one('curve-chart-empty')), 'the empty chart says nothing about why').toContain(
    'did not fit',
  )
})

Then('no axes are drawn', () => {
  // An empty frame with axes reads as a curve that happens to have no data on it, which is a
  // different and wrong thing to tell a reader.
  expect(document.querySelector('canvas'), 'an empty frame was drawn anyway').toBeNull()
})

// --- Then: a name that is user input ----------------------------------------

Then('that name is displayed exactly as written', (world: World) => {
  const name = world.sampleName as string | undefined
  expect(name, 'no step named a sample before this one').toBeDefined()

  const drawnLabel = (seriesNamed(drawnOption(), SERIES_SAMPLES).data ?? []).map((d) => d.name)
  expect(drawnLabel, 'the chart plotted the sample under a different name').toContain(name)

  const mark = markLabelled(name ?? '')
  expect(mark.getAttribute('aria-label'), 'the accessible name lost the characters').toContain(
    name,
  )
})

Then('no element from that name appears in the document', (world: World) => {
  const name = world.sampleName as string | undefined
  expect(name, 'no step named a sample before this one').toBeDefined()

  // `<b>` is the tag the name would produce if anything along the way treated it as markup.
  expect(document.querySelector('b'), 'the sample name was parsed as HTML').toBeNull()
})
