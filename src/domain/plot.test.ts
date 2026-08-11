import { describe, expect, it } from 'vitest'
import { fitCurve, predict, standardLevel } from './curve'
import { curvePlot } from './plot'
import { REFERENCE_CONCENTRATIONS, referenceFit, referenceLevels } from './reference'
import { analyseSamples } from './samples'

/** Proves features/analysis/curve-plot-geometry.feature. */

const FIT = referenceFit()
const RESULTS = analyseSamples(FIT, [
  { name: 'MCF7', replicates: [0.43] },
  { name: 'RPMI8226', replicates: [0.36] },
])

describe('the geometry of the reference curve', () => {
  const plot = curvePlot(FIT, RESULTS)

  it('places one point per standard and one per sample', () => {
    expect(plot.points.filter((p) => p.kind === 'standard')).toHaveLength(9)
    expect(plot.points.filter((p) => p.kind === 'sample')).toHaveLength(2)
    expect(plot.omitted).toEqual([])
    expect(plot.plottable).toBe(true)
  })

  it('plots absorbance against concentration, as read', () => {
    const blank = plot.points[0]
    expect(blank?.absorbance).toBe(0.132)
    expect(blank?.concUgPerML).toBe(0)
    const top = plot.points[8]
    expect(top?.absorbance).toBe(2.051)
    expect(top?.concUgPerML).toBe(2000)
  })

  it('labels a standard by its vial letter and a sample by its name', () => {
    expect(plot.points[0]?.label).toBe('I')
    expect(plot.points.find((p) => p.kind === 'sample')?.label).toBe('MCF7')
  })

  it('falls back to the concentration when a level has no vial letter', () => {
    const plain = curvePlot(fitCurve(REFERENCE_CONCENTRATIONS.map((c, i) =>
      standardLevel(c, [referenceLevels()[i]?.replicates[0] ?? null]),
    ), { blankSubtract: false }))
    expect(plain.points[8]?.label).toContain('2000')
  })

  it('runs the path between the extreme standard means and no further', () => {
    const xs = plot.path.map(([x]) => x)
    expect(Math.min(...xs)).toBeCloseTo(0.132, 12)
    expect(Math.max(...xs)).toBeCloseTo(2.051, 12)
  })

  it('samples the path densely enough that the steep low end has no visible corner', () => {
    expect(plot.path.length).toBe(121)
  })

  it('puts every path point on the fitted curve rather than near it', () => {
    for (const [x, y] of plot.path) {
      expect(y).toBeCloseTo(predict(FIT, x), 12)
    }
  })

  it('ends the path exactly on the last standard, not a rounding step short of it', () => {
    // Accumulating lo + step*i to the end would land a few ulps off the highest standard and
    // leave a hairline gap between the curve and the point it was fitted through.
    expect(plot.path[plot.path.length - 1]?.[0]).toBe(2.051)
  })

  it('honours a caller that wants a coarser path', () => {
    expect(curvePlot(FIT, [], { pathSamples: 10 }).path).toHaveLength(11)
  })

  it('bounds the axes over the points and the path together', () => {
    const xs = [...plot.points.map((p) => p.absorbance), ...plot.path.map(([x]) => x)]
    expect(plot.xMin).toBeCloseTo(Math.min(...xs), 12)
    expect(plot.xMax).toBeCloseTo(Math.max(...xs), 12)
    expect(plot.yMax).toBeGreaterThanOrEqual(2000)
  })

  it('always includes zero on the concentration axis', () => {
    // A standard curve that does not show where no protein sits has lost the reference the whole
    // picture is read against.
    expect(plot.yMin).toBeLessThanOrEqual(0)
  })

  it('marks a sample inside the standards as in range', () => {
    const sample = plot.points.find((p) => p.label === 'MCF7')
    expect(sample?.inRange).toBe(true)
    expect(sample?.fittedUgPerML).toBe(sample?.concUgPerML)
  })

  it('carries the replicate spread onto the sample points only', () => {
    const withSpread = analyseSamples(FIT, [{ name: 'MCF7', replicates: [0.42, 0.44] }])
    const point = curvePlot(FIT, withSpread).points.find((p) => p.kind === 'sample')
    expect(point?.cvPercent).not.toBeNull()
    expect(curvePlot(FIT).points.every((p) => p.cvPercent === null)).toBe(true)
  })

  it('carries recovery onto the standard points only, and not onto the blank', () => {
    // The blank has no recovery to report: 0/0 is undefined, not 100%.
    const standards = plot.points.filter((p) => p.kind === 'standard')
    expect(standards[0]?.recoveryPercent).toBeNull()
    expect(standards.slice(1).every((p) => p.recoveryPercent !== null)).toBe(true)
    expect(plot.points.filter((p) => p.kind === 'sample').every((p) => p.recoveryPercent === null))
      .toBe(true)
  })
})

describe('residual marks', () => {
  it('marks only the standards whose recovery missed its band', () => {
    // On every standard a residual line would be a picket fence restating the fit. On the one
    // that missed, it is the reason that row is yellow, made visible in the picture.
    //
    // The reference curve marks exactly one: vial H at 25 µg/mL recovers at 134%, which is the
    // lowest standard on an inverse cubic and the level where a few thousandths of absorbance
    // are worth tens of percent.
    const marked = curvePlot(FIT).points.filter((p) => p.residual)
    expect(marked.map((p) => p.label)).toEqual(['H'])
  })

  it('marks nothing on a curve that recovers everywhere', () => {
    // Straight points through a straight fit: every level recovers at 100%.
    const levels = [0, 250, 500, 750, 1000].map((c) => standardLevel(c, [c / 1000], `T${c}`))
    const plot = curvePlot(fitCurve(levels, { blankSubtract: false }))
    expect(plot.points.some((p) => p.residual)).toBe(false)
  })
})

describe('rows that cannot be placed', () => {
  it('omits a standard with no reading, by name, rather than dropping it silently', () => {
    const levels = referenceLevels()
    levels[3] = standardLevel(250, [null], 'F')
    const plot = curvePlot(fitCurve(levels, { blankSubtract: false }))
    expect(plot.points.filter((p) => p.kind === 'standard')).toHaveLength(8)
    expect(plot.omitted).toEqual(['F'])
  })

  it('omits a sample with nothing to read rather than drawing it at the origin', () => {
    // A fabricated point on a calibration curve is worse than a missing one.
    const results = analyseSamples(FIT, [{ name: 'Ghost', replicates: [null] }])
    const plot = curvePlot(FIT, results)
    expect(plot.points.some((p) => p.label === 'Ghost')).toBe(false)
    expect(plot.omitted).toEqual(['Ghost'])
  })

  it('marks an extrapolated sample as out of range while still plotting it', () => {
    const results = analyseSamples(FIT, [{ name: 'High', replicates: [2.5] }])
    const point = curvePlot(FIT, results).points.find((p) => p.label === 'High')
    expect(point).toBeDefined()
    expect(point?.inRange).toBe(false)
  })
})

describe('a plot with nothing to draw', () => {
  it('reports itself unplottable rather than returning a degenerate frame', () => {
    const plot = curvePlot(fitCurve([], { blankSubtract: false }))
    expect(plot.plottable).toBe(false)
    expect(plot.path).toEqual([])
    expect(plot.points).toEqual([])
    expect([plot.xMin, plot.xMax, plot.yMin, plot.yMax]).toEqual([0, 0, 0, 0])
  })

  it('draws one path point when every standard sits at the same absorbance', () => {
    const levels = [0, 25, 125].map((c) => standardLevel(c, [0.5]))
    const plot = curvePlot(fitCurve(levels, { blankSubtract: false }))
    expect(plot.path.length).toBeLessThanOrEqual(1)
  })
})
