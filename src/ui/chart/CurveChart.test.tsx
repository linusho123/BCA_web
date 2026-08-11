/**
 * Component tests for the curve chart. Real Chromium, because every claim here is about
 * layout, focus or a real event — none of it is checkable against a returned object.
 *
 * What the option builder already proves (which series exist, which shape each uses, whether
 * a label is drawn) is not re-proven here. This is the half that needs pixels.
 */

import { expect, test } from 'vitest'
import { render } from 'vitest-browser-preact'
import { userEvent } from 'vitest/browser'
import { analyseSamples } from '~/domain/samples'
import { curvePlot } from '~/domain/plot'
import { fitCurve } from '~/domain/curve'
import { referenceFit } from '~/domain/reference'
import { CurveChart, readoutText } from './CurveChart'

const withSamples = (n = 2) => {
  const fit = referenceFit()
  const inputs = Array.from({ length: n }, (_, i) => ({
    name: `S${i + 1}`,
    replicates: [0.4 + i * 0.02],
  }))
  return curvePlot(fit, analyseSamples(fit, inputs))
}

test('draws a focusable button for every plotted point', async () => {
  const plot = withSamples()
  const screen = render(<CurveChart plot={plot} />)

  const marks = screen.getByTestId('plot-point')
  await expect.poll(() => marks.all().length).toBe(plot.points.length)
})

test('each mark announces its own label', async () => {
  const plot = withSamples(1)
  const screen = render(<CurveChart plot={plot} />)

  // The blank is tube I, the first standard in the reference series.
  const blank = plot.points.find((p) => p.label === 'I')
  expect(blank).toBeDefined()
  await expect
    .element(screen.getByRole('button', { name: readoutText(blank!) }))
    .toBeInTheDocument()
})

test('hover, click and keyboard focus all reach the same readout', async () => {
  const plot = withSamples(1)
  // The 25 µg/mL standard is tube H.
  const target = plot.points.find((p) => p.label === 'H')!
  const expected = readoutText(target)

  const screen = render(<CurveChart plot={plot} />)
  const readout = screen.getByTestId('curve-readout')
  const mark = screen.getByRole('button', { name: expected })

  await mark.hover()
  await expect.element(readout).toHaveTextContent(expected)

  await mark.click()
  await expect.element(readout).toHaveTextContent(expected)

  // Focus by keyboard rather than by calling .focus(), so this proves the mark is in the tab
  // order and not merely programmatically focusable.
  await userEvent.keyboard('{Tab}')
  await expect.poll(() => document.activeElement?.tagName).toBe('BUTTON')
  await mark.click()
  await expect.element(readout).toHaveTextContent(expected)
})

test('the readout clears when focus leaves rather than freezing', async () => {
  const plot = withSamples(1)
  const target = plot.points.find((p) => p.label === 'H')!
  const screen = render(<CurveChart plot={plot} />)
  const readout = screen.getByTestId('curve-readout')

  const mark = screen.getByRole('button', { name: readoutText(target) })
  await mark.click()
  await expect.element(readout).toHaveTextContent(readoutText(target))

  await userEvent.click(document.body)
  await expect.poll(() => readout.element().textContent.trim()).toBe('')
})

test('every point can be reached in turn with the keyboard', async () => {
  const plot = withSamples(1)
  const screen = render(<CurveChart plot={plot} />)
  await expect.poll(() => screen.getByTestId('plot-point').all().length)
    .toBe(plot.points.length)

  const reached = new Set<string>()
  for (let i = 0; i < plot.points.length; i++) {
    await userEvent.keyboard('{Tab}')
    const label = document.activeElement?.getAttribute('data-label')
    if (label !== null && label !== undefined) reached.add(label)
  }
  expect(reached.size).toBe(plot.points.length)
})

test('a sample name carrying markup is shown as characters, not parsed', async () => {
  const fit = referenceFit()
  const name = '<b>&"x"'
  const plot = curvePlot(fit, analyseSamples(fit, [{ name, replicates: [0.43] }]))

  const screen = render(<CurveChart plot={plot} />)
  const chart = screen.getByTestId('curve-chart')

  await expect.poll(() => chart.element().querySelector('b')).toBe(null)
  await expect
    .element(screen.getByRole('button', { name: new RegExp(String.raw`Sample <b>&"x"`) }))
    .toBeInTheDocument()
})

test('a fit that produced nothing states why instead of drawing an empty frame', async () => {
  const plot = curvePlot(fitCurve([], { blankSubtract: false }))
  const screen = render(<CurveChart plot={plot} />)

  await expect.element(screen.getByTestId('curve-chart-empty')).toBeVisible()
  await expect.element(screen.getByText(/did not fit/)).toBeVisible()
  expect(document.querySelector('canvas')).toBe(null)
})

test('names what it shows rather than what kind of chart it is', () => {
  const screen = render(<CurveChart plot={withSamples(2)} />)
  const label = screen.getByRole('img').element().getAttribute('aria-label') ?? ''
  expect(label).toContain('9 standards')
  expect(label).toContain('2 samples')
})

test('reports a level that could not be plotted', async () => {
  const fit = referenceFit()
  const levels = fit.levels.map((l, i) => (i === 3 ? { ...l, replicates: [null] } : l))
  const plot = curvePlot(fitCurve(levels, { blankSubtract: false }))

  const screen = render(<CurveChart plot={plot} />)
  await expect.element(screen.getByText(/Not plotted/)).toBeVisible()
})
