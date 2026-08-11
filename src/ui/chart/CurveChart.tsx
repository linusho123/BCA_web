/**
 * The standard curve chart.
 *
 * ECharts draws to a canvas, and a canvas has no DOM: nothing in it can be tabbed to, and a
 * screen reader sees one opaque element. features/analysis/curve-plot-presentation.feature
 * requires that every plotted point be reachable by keyboard and that focus show exactly what
 * hover shows, so the canvas is not the whole component — a layer of real buttons is positioned
 * over it, one per point, and those are what carry focus, the accessible name and the readout.
 *
 * The two halves are driven from one source. `curvePlot` decides where the points are;
 * `curveOption` turns that into pixels; this positions the buttons from the same geometry via
 * `convertToPixel`. A point cannot appear in one and not the other, because neither of them
 * decides which points exist.
 *
 * The chart enhances and never gates: every number here is also in the standards table beside
 * it, which is why a reader who cannot use a chart at all loses nothing but convenience.
 */

import { useEffect, useRef, useState } from 'preact/hooks'
import type { EChartsOption } from 'echarts'
import type { CurvePlot, PlotPoint } from '~/domain/plot'
import { fixed, grouped } from '~/domain/format'
import { echarts } from './echarts'
import { curveOption } from './curveOption'

export interface CurveChartProps {
  plot: CurvePlot
  height?: number
  /** A one-line summary of what the chart shows, for a reader who will not see it. */
  ariaLabel?: string
}

/** What the readout says about one point. Also the button's accessible name. */
export function readoutText(point: PlotPoint): string {
  const kind = point.kind === 'standard' ? 'Standard' : 'Sample'
  return (
    `${kind} ${point.label}: absorbance ${fixed(point.absorbance, 4)}, ` +
    `${grouped(point.concUgPerML, 1)} µg/mL`
  )
}

/**
 * Read through an index rather than as `globalThis.matchMedia`, which the DOM library types as
 * always present. It is not — the unit project runs in node, where it is absent — and typing it
 * honestly is what keeps the guard below from being reported as dead code.
 */
export function prefersReducedMotion(): boolean {
  const query = (globalThis as { matchMedia?: typeof window.matchMedia }).matchMedia
  return query === undefined ? false : query('(prefers-reduced-motion: reduce)').matches
}

/**
 * Exactly the option this chart draws, motion preference included.
 *
 * A named function rather than an expression inside the effect, because
 * features/analysis/curve-plot-presentation.feature asserts what the chart does under reduced
 * motion, and a step that rebuilt the option itself would be asserting against its own copy.
 */
export function chartOption(plot: CurvePlot): EChartsOption {
  return curveOption(plot, { animate: !prefersReducedMotion() })
}

export function CurveChart({ plot, height = 380, ariaLabel }: CurveChartProps) {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const [positions, setPositions] = useState<ReadonlyArray<readonly [number, number]>>([])
  const [active, setActive] = useState<number | null>(null)

  // The resize handler outlives the render that created it, so it reads the plot through a ref
  // rather than through its closure — otherwise a resize after a re-fit would reposition the
  // marks from the geometry of the previous curve.
  const latest = useRef(plot)
  latest.current = plot

  // Keyed on `plottable`, not on nothing: an unplottable curve renders the empty state instead of
  // the host div, so the host element below is a different element each time a fit starts working
  // or stops. With `[]` deps the instance would be created against the first host only — and a
  // page that was pasted into before it was laid out would never draw a chart at all.
  useEffect(() => {
    const el = host.current
    if (!el) return

    const instance = echarts.init(el)
    chart.current = instance
    instance.setOption(chartOption(latest.current))
    setPositions(pixelPositions(instance, latest.current))

    // ECharts does not watch its container, so without this the chart keeps the width it had
    // when the panel beside it was collapsed.
    const observer = new ResizeObserver(() => {
      instance.resize()
      setPositions(pixelPositions(instance, latest.current))
    })
    observer.observe(el)

    return () => {
      observer.disconnect()
      instance.dispose() // Undisposed instances leak the canvas and every listener on it.
      chart.current = null
    }
  }, [plot.plottable])

  useEffect(() => {
    const instance = chart.current
    if (!instance) return
    // `replaceMerge` on series: without it, removing a sample would leave its old series drawn,
    // because setOption merges by default.
    instance.setOption(chartOption(plot), { replaceMerge: ['series'] })
    setPositions(pixelPositions(instance, plot))
    setActive(null)
  }, [plot])

  const shown = active === null ? null : plot.points[active] ?? null

  if (!plot.plottable) {
    return (
      <div
        class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed
               border-slate-300 p-8 text-center text-sm text-slate-600"
        style={{ height }}
        data-testid="curve-chart-empty"
      >
        <p class="font-medium">No curve to plot</p>
        <p>
          The standard curve did not fit, so there is nothing to draw. The issues panel says
          why, and the standards table below still shows every reading.
        </p>
      </div>
    )
  }

  return (
    <figure class="m-0" data-testid="curve-chart">
      <div class="relative" style={{ height }}>
        <div
          ref={host}
          class="h-full w-full"
          role="img"
          aria-label={ariaLabel ?? defaultLabel(plot)}
        />

        {/*
          One button per point, positioned over the canvas. `aria-hidden` is deliberately absent:
          these ARE the accessible chart. The canvas behind them is decoration by the time a
          screen reader gets here.
        */}
        <div class="pointer-events-none absolute inset-0">
          {plot.points.map((point, index) => {
            const at = positions[index]
            if (!at) return null
            return (
              <button
                key={`${point.kind}:${point.label}`}
                type="button"
                data-testid="plot-point"
                data-kind={point.kind}
                data-label={point.label}
                class="pointer-events-auto absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2
                       rounded-full focus:outline-2 focus:outline-offset-2 focus:outline-brand-600"
                style={{ left: `${at[0]}px`, top: `${at[1]}px` }}
                aria-label={readoutText(point)}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive((i) => (i === index ? null : i))}
                onFocus={() => setActive(index)}
                onBlur={() => setActive((i) => (i === index ? null : i))}
                onClick={() => setActive(index)}
              />
            )
          })}
        </div>
      </div>

      {/*
        The readout is one element reached three ways — hover, click, focus — rather than a
        tooltip for the mouse and something else for the keyboard. `aria-live` announces it on
        focus without moving focus, which is what lets a reader tab across the points and hear
        each one.
      */}
      <figcaption
        class="mt-2 min-h-6 text-sm text-slate-700"
        data-testid="curve-readout"
        aria-live="polite"
      >
        {shown === null ? '' : readoutText(shown)}
      </figcaption>

      {plot.omitted.length > 0 && (
        <p class="mt-1 text-xs text-slate-500">
          Not plotted: {plot.omitted.join(', ')} — no readable well.
        </p>
      )}
    </figure>
  )
}

/** Where each point sits in the container, in pixels. Empty until the chart has laid out. */
function pixelPositions(
  instance: echarts.ECharts,
  plot: CurvePlot,
): ReadonlyArray<readonly [number, number]> {
  return plot.points.map((p) => {
    const at = instance.convertToPixel({ seriesIndex: p.kind === 'standard' ? 1 : 2 }, [
      p.absorbance,
      p.concUgPerML,
    ]) as [number, number] | null
    return at ?? ([-9999, -9999] as const)
  })
}

/**
 * A summary of what the chart shows, not of what kind of chart it is.
 *
 * "Nine standards from 0 to 2,000 µg/mL with 2 samples" tells a reader something; "scatter
 * chart" tells them only that they cannot see it.
 */
function defaultLabel(plot: CurvePlot): string {
  const standards = plot.points.filter((p) => p.kind === 'standard')
  const samples = plot.points.filter((p) => p.kind === 'sample')
  const concentrations = standards.map((p) => p.concUgPerML)
  const span =
    concentrations.length > 0
      ? ` from ${grouped(Math.min(...concentrations))} to ${grouped(Math.max(...concentrations))} µg/mL`
      : ''
  return (
    `Standard curve: ${standards.length} standards${span}, ` +
    `with ${samples.length} sample${samples.length === 1 ? '' : 's'} plotted on it.`
  )
}
