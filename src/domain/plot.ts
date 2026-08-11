/**
 * The standard curve as plottable geometry.
 *
 * Ported from BCA_quarto `src/bca/plot.py`, geometry half only (specdoc §3.6).
 *
 * DEVIATION FROM THE SOURCE PROJECT, stated deliberately and argued in
 * features/analysis/curve-plot-geometry.feature. BCA_quarto builds the entire SVG string inside
 * the calculation core, and asserts that its Python and JavaScript ports emit byte-identical
 * markup. That existed because the Quarto project shipped one app twice — Shinylive and
 * hand-written JS — and had no other way to stop the two charts drifting.
 *
 * This app ships once. The parity reason is gone, and a hand-rolled SVG renderer is not worth
 * maintaining without it, so rendering moves to ECharts. What stays is the half that was
 * load-bearing for correctness: the geometry is computed here, from the fit, and the chart
 * layer computes no coordinate and no displayed number of its own.
 *
 * The x axis is **raw** absorbance — what the reader printed and what the well shows — rather
 * than the blank-corrected value the polynomial is a function of. The two differ by a constant,
 * so the picture is identical; raw is the one that can be checked against the plate in front of
 * you without subtracting anything first.
 */

import { RECOVERY_HIGH_PERCENT, RECOVERY_LOW_PERCENT } from './constants'
import { type CurveFit, inRange, predict } from './curve'
import { num } from './format'
import type { SampleResult } from './samples'

/**
 * Points sampled along the fitted path. Smooth well before this; the cost of overshooting is a
 * few hundred bytes, and the cost of undershooting is visible corners in the steep low end,
 * which a reader is entitled to interpret as data.
 */
const CURVE_PATH_SAMPLES = 120

export type PointKind = 'standard' | 'sample'

export interface PlotPoint {
  readonly kind: PointKind
  readonly label: string
  /** Raw, as read. Not blank-corrected — see the module header. */
  readonly absorbance: number
  readonly concUgPerML: number
  readonly fittedUgPerML: number | null
  readonly inRange: boolean
  /** Standards only: how far this level back-calculates from its nominal value. */
  readonly recoveryPercent: number | null
  /** Samples only: the spread of the replicates behind this point. */
  readonly cvPercent: number | null
  /**
   * True where recovery missed its band. Drawn as a residual line to the fitted curve.
   * On every standard it would be a picket fence restating the fit; on the one that missed it
   * is the reason that row is yellow in the table, made visible in the picture.
   */
  readonly residual: boolean
}

export interface CurvePlot {
  readonly points: readonly PlotPoint[]
  /** [absorbance, concentration] pairs along the fitted curve, within the standards only. */
  readonly path: ReadonlyArray<readonly [number, number]>
  readonly xMin: number
  readonly xMax: number
  readonly yMin: number
  readonly yMax: number
  /** Rows that could not be placed, by name, so nothing vanishes without being accounted for. */
  readonly omitted: readonly string[]
  readonly plottable: boolean
}

export interface CurvePlotOptions {
  pathSamples?: number
}

export function curvePlot(
  fit: CurveFit,
  results: readonly SampleResult[] = [],
  options: CurvePlotOptions = {},
): CurvePlot {
  const { pathSamples = CURVE_PATH_SAMPLES } = options
  const points: PlotPoint[] = []
  const omitted: string[] = []

  fit.levels.forEach((level, index) => {
    const mean = fit.levelMeans[index] ?? null
    const label = level.tubeId ?? `${num(level.concUgPerML)} µg/mL`
    if (mean === null) {
      omitted.push(label)
      return
    }
    const recovery = fit.recoveries[index] ?? null
    points.push({
      kind: 'standard',
      label,
      absorbance: mean,
      concUgPerML: level.concUgPerML,
      fittedUgPerML: fit.fitted ? predict(fit, mean) : null,
      inRange: inRange(fit, mean),
      recoveryPercent: recovery,
      cvPercent: null,
      residual:
        recovery !== null &&
        !(recovery >= RECOVERY_LOW_PERCENT && recovery <= RECOVERY_HIGH_PERCENT),
    })
  })

  for (const result of results) {
    // A sample with no readings is absent from the plot entirely. Drawing it at the origin
    // would put a fabricated point on a calibration curve, which is worse than leaving it out.
    if (result.meanAbs === null || result.concUgPerML === null) {
      omitted.push(result.name)
      continue
    }
    points.push({
      kind: 'sample',
      label: result.name,
      absorbance: result.meanAbs,
      concUgPerML: result.concUgPerML,
      fittedUgPerML: result.concUgPerML,
      inRange: !result.extrapolated,
      recoveryPercent: null,
      cvPercent: result.cvPercent,
      residual: false,
    })
  }

  // The path runs between the extreme standard *means* — the raw counterparts of absMin and
  // absMax, which are those same values less the blank offset. Taking them from the means
  // avoids re-deriving the offset and so cannot disagree with it.
  const means = fit.levelMeans.filter((m): m is number => m !== null)
  const path: Array<readonly [number, number]> = []
  if (fit.fitted && means.length > 0) {
    const lo = Math.min(...means)
    const hi = Math.max(...means)
    if (hi === lo) {
      path.push([lo, predict(fit, lo)] as const)
    } else {
      const step = (hi - lo) / pathSamples
      for (let i = 0; i <= pathSamples; i++) {
        const x = i < pathSamples ? lo + step * i : hi
        path.push([x, predict(fit, x)] as const)
      }
    }
  }

  const xs = [...points.map((p) => p.absorbance), ...path.map(([x]) => x)]
  const ys = [...points.map((p) => p.concUgPerML), ...path.map(([, y]) => y)]

  return {
    points,
    path,
    xMin: xs.length > 0 ? Math.min(...xs) : 0,
    xMax: xs.length > 0 ? Math.max(...xs) : 0,
    // Zero is always on the concentration axis. A standard curve that does not show where no
    // protein sits has lost the reference the whole picture is read against, and the blank is a
    // real point on it.
    yMin: ys.length > 0 ? Math.min(0, ...ys) : 0,
    yMax: ys.length > 0 ? Math.max(...ys) : 0,
    omitted,
    plottable: path.length > 0,
  }
}
