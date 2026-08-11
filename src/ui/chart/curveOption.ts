/**
 * The curve chart's ECharts option, as a pure function of the plot geometry.
 *
 * Built here rather than inside the component so that most of what the chart promises can be
 * asserted without a browser: which series exist, what shape each uses, whether a mark is
 * hollow, whether a label is drawn. Only the parts that genuinely need pixels — focus, hover,
 * the readout — are left to the component test.
 *
 * The geometry itself is not computed here. `curvePlot` in the domain decides which points
 * exist and where they sit; this decides how they look. Keeping those apart is what lets the
 * geometry feature run in node.
 */

import type { EChartsOption } from 'echarts'
import type { CurvePlot, PlotPoint } from '~/domain/plot'
import { grouped } from '~/domain/format'

/** Above this many samples, direct labels stop helping and start overlapping each other. */
export const MAX_DIRECT_LABELS = 4

export const STANDARD_SYMBOL = 'circle'
export const SAMPLE_SYMBOL = 'triangle'

export const SERIES_CURVE = 'Fitted curve'
export const SERIES_STANDARDS = 'Standards'
export const SERIES_SAMPLES = 'Samples'

export interface CurveOptionSettings {
  /** Set false under `prefers-reduced-motion`; changes nothing the chart says. */
  animate?: boolean
  standardColor?: string
  sampleColor?: string
  curveColor?: string
  textColor?: string
}

const points = (plot: CurvePlot, kind: PlotPoint['kind']): PlotPoint[] =>
  plot.points.filter((p) => p.kind === kind)

/**
 * Whether direct labels are drawn on the sample marks.
 *
 * Exported because the component needs the same answer for the DOM layer it draws over the
 * canvas, and two implementations of "few enough to read" would eventually disagree.
 */
export function showsDirectLabels(plot: CurvePlot): boolean {
  const n = points(plot, 'sample').length
  return n > 0 && n <= MAX_DIRECT_LABELS
}

/**
 * A sample outside the calibrated range is drawn hollow.
 *
 * Fill rather than hue, because a reader who cannot separate two colours can still separate a
 * filled shape from an outlined one — and so can a greyscale printout.
 */
const markStyle = (point: PlotPoint, color: string) =>
  point.inRange
    ? { color }
    : { color: 'transparent', borderColor: color, borderWidth: 2 }

export function curveOption(
  plot: CurvePlot,
  settings: CurveOptionSettings = {},
): EChartsOption {
  const {
    animate = true,
    standardColor = '#2563eb',
    sampleColor = '#c2410c',
    curveColor = '#94a3b8',
    textColor = '#1e293b',
  } = settings

  const standards = points(plot, 'standard')
  const samples = points(plot, 'sample')
  const labelled = showsDirectLabels(plot)

  return {
    animation: animate,
    // ECharts' own description, for the readers who get one from the canvas element.
    aria: { enabled: true, decal: { show: true } },
    legend: {
      // Named explicitly rather than left to ECharts' series inference, because the legend has
      // to be there whenever a curve is plotted — including when a series happens to be empty.
      data: [SERIES_CURVE, SERIES_STANDARDS, SERIES_SAMPLES],
      textStyle: { color: textColor },
      top: 0,
    },
    grid: { left: 64, right: 24, top: 40, bottom: 48, containLabel: true },
    xAxis: {
      type: 'value',
      name: 'Absorbance (562 nm)',
      nameLocation: 'middle',
      nameGap: 30,
      min: plot.xMin,
      max: plot.xMax,
      axisLabel: { color: textColor },
    },
    yAxis: {
      type: 'value',
      name: 'Concentration (µg/mL)',
      nameLocation: 'middle',
      nameGap: 48,
      min: plot.yMin,
      max: plot.yMax,
      // Grouped the way a reader writes a number: 1,000 rather than 1000.
      axisLabel: { color: textColor, formatter: (value: number) => grouped(value) },
    },
    tooltip: { trigger: 'item' },
    series: [
      {
        name: SERIES_CURVE,
        type: 'line',
        data: plot.path.map(([x, y]) => [x, y]),
        showSymbol: false,
        lineStyle: { color: curveColor, width: 2 },
        silent: true,
        z: 1,
      },
      {
        name: SERIES_STANDARDS,
        type: 'scatter',
        symbol: STANDARD_SYMBOL,
        symbolSize: 11,
        data: standards.map((p) => ({
          value: [p.absorbance, p.concUgPerML],
          name: p.label,
          itemStyle: markStyle(p, standardColor),
        })),
        z: 2,
      },
      {
        name: SERIES_SAMPLES,
        type: 'scatter',
        symbol: SAMPLE_SYMBOL,
        symbolSize: 13,
        data: samples.map((p) => ({
          value: [p.absorbance, p.concUgPerML],
          name: p.label,
          itemStyle: markStyle(p, sampleColor),
        })),
        label: {
          show: labelled,
          position: 'right',
          color: textColor,
          // `formatter` as a function, so a name carrying markup reaches the canvas as the
          // characters it is. ECharts' string templates do not interpret HTML either, but a
          // function makes that a property of this code rather than of its defaults.
          formatter: (params: { name?: string }) => params.name ?? '',
        },
        z: 3,
      },
    ],
  }
}
