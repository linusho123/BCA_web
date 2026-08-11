import { describe, expect, it } from 'vitest'
import { analyseSamples } from '~/domain/samples'
import { curvePlot } from '~/domain/plot'
import { fitCurve } from '~/domain/curve'
import { referenceFit, referenceLevels } from '~/domain/reference'
import {
  curveOption,
  MAX_DIRECT_LABELS,
  SAMPLE_SYMBOL,
  SERIES_CURVE,
  SERIES_SAMPLES,
  SERIES_STANDARDS,
  showsDirectLabels,
  STANDARD_SYMBOL,
} from './curveOption'

type SeriesList = ReadonlyArray<Record<string, unknown>>
type Datum = { value: [number, number]; name: string; itemStyle: Record<string, unknown> }

const seriesOf = (option: ReturnType<typeof curveOption>): SeriesList =>
  option.series as SeriesList

const named = (option: ReturnType<typeof curveOption>, name: string) =>
  seriesOf(option).find((s) => s['name'] === name) as Record<string, unknown>

/** The reference curve with `n` unknowns on it, all reading inside the calibrated span. */
function plotWithSamples(n: number) {
  const fit = referenceFit()
  const inputs = Array.from({ length: n }, (_, i) => ({
    name: `S${i + 1}`,
    replicates: [0.4 + i * 0.01],
  }))
  return curvePlot(fit, analyseSamples(fit, inputs))
}

describe('series', () => {
  it('names the curve, the standards and the samples', () => {
    const option = curveOption(plotWithSamples(2))
    expect(seriesOf(option).map((s) => s['name'])).toEqual([
      SERIES_CURVE,
      SERIES_STANDARDS,
      SERIES_SAMPLES,
    ])
  })

  it('gives standards and samples different shapes, not only different colours', () => {
    const option = curveOption(plotWithSamples(2))
    expect(named(option, SERIES_STANDARDS)['symbol']).toBe(STANDARD_SYMBOL)
    expect(named(option, SERIES_SAMPLES)['symbol']).toBe(SAMPLE_SYMBOL)
    expect(STANDARD_SYMBOL).not.toBe(SAMPLE_SYMBOL)
  })

  it('lists all three in the legend even when a series is empty', () => {
    // A plot with no unknowns on it still gets a samples entry: the legend is a key to the
    // chart, and a key that appears only once there is something in it is one a reader has to
    // re-learn on every run.
    const option = curveOption(curvePlot(referenceFit()))
    expect(option.legend).toMatchObject({
      data: [SERIES_CURVE, SERIES_STANDARDS, SERIES_SAMPLES],
    })
  })

  it('draws the samples above the standards above the curve', () => {
    const option = curveOption(plotWithSamples(1))
    const z = (name: string) => named(option, name)['z'] as number
    expect(z(SERIES_SAMPLES)).toBeGreaterThan(z(SERIES_STANDARDS))
    expect(z(SERIES_STANDARDS)).toBeGreaterThan(z(SERIES_CURVE))
  })
})

describe('marks', () => {
  it('fills a sample inside the calibrated range', () => {
    const option = curveOption(plotWithSamples(1))
    const [datum] = named(option, SERIES_SAMPLES)['data'] as Datum[]
    expect(typeof datum?.itemStyle['color']).toBe('string')
    expect(datum?.itemStyle['color']).not.toBe('transparent')
  })

  it('draws a sample above every standard hollow', () => {
    const fit = referenceFit()
    const results = analyseSamples(fit, [{ name: 'High', replicates: [2.4] }])
    const option = curveOption(curvePlot(fit, results))
    const [datum] = named(option, SERIES_SAMPLES)['data'] as Datum[]
    expect(datum?.itemStyle).toMatchObject({ color: 'transparent', borderWidth: 2 })
  })

  it('carries each point label as the datum name', () => {
    const option = curveOption(plotWithSamples(1))
    const data = named(option, SERIES_STANDARDS)['data'] as Datum[]
    // The reference standards are tube-labelled, ascending in concentration.
    expect(data.map((d) => d.name)).toEqual(['I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'])
  })
})

describe('direct labels', () => {
  it.each([
    [1, true],
    [MAX_DIRECT_LABELS, true],
    [MAX_DIRECT_LABELS + 1, false],
  ])('with %i samples, labels shown is %s', (n, shown) => {
    const plot = plotWithSamples(n)
    expect(showsDirectLabels(plot)).toBe(shown)
    expect((curveOption(plot)['series'] as SeriesList)[2]?.['label']).toMatchObject({ show: shown })
  })

  it('shows none when there are no samples at all', () => {
    expect(showsDirectLabels(curvePlot(referenceFit()))).toBe(false)
  })

  it('renders a name through a function, so markup stays characters', () => {
    const option = curveOption(plotWithSamples(1))
    const label = named(option, SERIES_SAMPLES)['label'] as {
      formatter: (p: { name?: string }) => string
    }
    expect(label.formatter({ name: '<b>&"x"' })).toBe('<b>&"x"')
  })
})

describe('axes', () => {
  it('groups the concentration axis the way a reader writes numbers', () => {
    const option = curveOption(plotWithSamples(1))
    const axis = option.yAxis as { axisLabel: { formatter: (v: number) => string } }
    expect(axis.axisLabel.formatter(1000)).toBe('1,000')
    expect(axis.axisLabel.formatter(999)).toBe('999')
  })

  it('spans the geometry the domain computed rather than a range of its own', () => {
    const plot = plotWithSamples(2)
    const option = curveOption(plot)
    expect(option.xAxis).toMatchObject({ min: plot.xMin, max: plot.xMax })
    expect(option.yAxis).toMatchObject({ min: plot.yMin, max: plot.yMax })
  })
})

describe('reduced motion', () => {
  it('turns animation off without changing anything the chart says', () => {
    const plot = plotWithSamples(2)
    const moving = curveOption(plot, { animate: true })
    const still = curveOption(plot, { animate: false })

    expect(still.animation).toBe(false)
    expect(moving.animation).toBe(true)
    expect(JSON.stringify(still.series)).toEqual(JSON.stringify(moving.series))
  })
})

describe('a fit that produced nothing', () => {
  it('has an empty path and no points, so the component can say why', () => {
    const plot = curvePlot(fitCurve([], { blankSubtract: false }))
    expect(plot.plottable).toBe(false)
    const option = curveOption(plot)
    expect(named(option, SERIES_STANDARDS)['data']).toEqual([])
    expect(named(option, SERIES_CURVE)['data']).toEqual([])
  })
})

describe('accessibility', () => {
  it('enables the description and decals ECharts generates', () => {
    expect(curveOption(plotWithSamples(1)).aria).toMatchObject({
      enabled: true,
      decal: { show: true },
    })
  })
})

describe('the standards it plots', () => {
  it('are the levels the fit was built from', () => {
    const option = curveOption(curvePlot(referenceFit()))
    expect((named(option, SERIES_STANDARDS)['data'] as Datum[]).length).toBe(
      referenceLevels().length,
    )
  })
})
