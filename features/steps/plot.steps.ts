import { Given, Then, When } from 'quickpickle'
import { expect } from 'vitest'
import { type CurveFit, type StandardLevel, fitCurve, standardLevel } from '~/domain/curve'
import { type CurvePlot, type PlotPoint, curvePlot } from '~/domain/plot'
import { type SampleInput, type SampleResult, analyseSamples } from '~/domain/samples'
import {
  REFERENCE_ABSORBANCES,
  REFERENCE_CONCENTRATIONS,
  REFERENCE_TUBE_IDS,
} from '~/domain/reference'
import { type World, expectAt, number, slot } from '../support/world'

/**
 * Proves features/analysis/curve-plot-geometry.feature.
 *
 * Only the geometry half. The presentation feature beside it is proven at component altitude,
 * because "focus shows what hover shows" is a claim about a rendered chart and there is nothing
 * at this altitude to render one.
 *
 * The curve steps and the sample steps own most of the Givens this feature layers — the
 * reference fit, a dropped level, a sample with nothing readable in it — because those sentences
 * were already registered there and QuickPickle's registry is global. What is added here is the
 * plot: one When, and the assertions about where things ended up.
 */

/** An absorbance above every standard, so the sample lands past the end of the fitted path. */
const ABOVE_EVERY_STANDARD = 2.4

/**
 * The fit the scenario means, re-fitted when a Given changed the standards after the Background.
 *
 * Every scenario here starts from a Background that fits the workbook's curve, and some then say
 * something that changes the standards — a level with nothing in it, a series of flat
 * absorbances. Those Givens belong to the curve feature and assemble levels without fitting,
 * because that feature fits in its own When. Comparing the array by identity tells the two cases
 * apart: the levels the Background fitted are the same array the fit is holding, and a Given that
 * replaced them is not.
 */
function fit(world: World): CurveFit {
  const fitted = slot<CurveFit>(world, 'fit')
  const levels = world.levels as StandardLevel[] | undefined
  if (levels === undefined || levels === fitted.levels) return fitted
  const blankSubtract = (world.blankSubtract as boolean | undefined) ?? false
  const next = fitCurve(levels, { blankSubtract })
  world.fit = next
  return next
}

function plot(world: World): CurvePlot {
  return slot<CurvePlot>(world, 'plot')
}

function pointsOfKind(world: World, kind: 'standard' | 'sample'): PlotPoint[] {
  return plot(world).points.filter((p) => p.kind === kind)
}

/** Append to whatever samples the scenario has already named, keeping the order it named them. */
function addSample(world: World, sample: SampleInput): void {
  world.samples = [...((world.samples as SampleInput[] | undefined) ?? []), sample]
}

// --- Given ----------------------------------------------------------------

/**
 * The workbook's two unknowns, at the dilution factor the RIPA sheet ran them at.
 *
 * Three replicates rather than the single reading the reference table records, spread a hundredth
 * either side of it. A point built from one reading has no spread and therefore no coefficient of
 * variation, and one of these scenarios is that every sample point carries one. The mean is
 * unchanged, so the concentration this produces is still the workbook's.
 */
Given('the analysed samples MCF7 and RPMI8226', (world: World) => {
  addSample(world, { name: 'MCF7', replicates: [0.42, 0.43, 0.44] })
  addSample(world, { name: 'RPMI8226', replicates: [0.35, 0.36, 0.37] })
  world.dilutionFactor = 2
})

Given('a sample reading above every standard', (world: World) => {
  world.outOfRangeSample = 'Concentrated'
  addSample(world, { name: 'Concentrated', replicates: [ABOVE_EVERY_STANDARD] })
})

Given('a set of standards none of which is a blank', (world: World) => {
  // The blank dropped from the workbook's own series rather than a series invented for the
  // occasion. This is the plate a researcher runs when they are a tube short, and the claim is
  // that the axis still reaches the zero the whole curve is read against.
  const levels = REFERENCE_CONCENTRATIONS.map((conc, i) =>
    standardLevel(conc, [REFERENCE_ABSORBANCES[i] as number], REFERENCE_TUBE_IDS[i] as string),
  ).filter((level) => level.concUgPerML > 0)
  world.levels = levels
  world.blankSubtract = false
  world.fit = fitCurve(levels, { blankSubtract: false })
})

// --- When -----------------------------------------------------------------

When('the curve plot is built', (world: World) => {
  const samples = (world.samples as SampleInput[] | undefined) ?? []
  const factor = world.dilutionFactor as number | undefined
  const results: SampleResult[] =
    samples.length === 0
      ? []
      : analyseSamples(fit(world), samples, factor === undefined ? {} : { dilutionFactor: factor })
  world.results = results
  world.plot = curvePlot(fit(world), results)
})

// --- Then: the points -----------------------------------------------------

Then(
  'the plot holds {int} standard points and {int} sample points',
  (world: World, standards: number, samples: number) => {
    expect(
      pointsOfKind(world, 'standard').map((p) => p.label),
      'the standard points',
    ).toHaveLength(standards)
    expect(
      pointsOfKind(world, 'sample').map((p) => p.label),
      'the sample points',
    ).toHaveLength(samples)
  },
)

Then('the standards come before the samples', (world: World) => {
  // Not a cosmetic ordering. A renderer draws in array order, so this is what puts the sample
  // marks on top of the curve rather than underneath it.
  const kinds = plot(world).points.map((p) => p.kind)
  expect(kinds.indexOf('sample'), 'the first sample point').toBeGreaterThan(
    kinds.lastIndexOf('standard'),
  )
})

Then("each standard's plotted absorbance is its measured mean", (world: World) => {
  const curve = fit(world)
  // The scenario is only worth running against a fit that subtracted something, or the raw and
  // the corrected value are the same number and the assertion would hold either way.
  expect(curve.blankSubtracted, 'the Background fitted with blank subtraction').toBe(true)
  expect(
    pointsOfKind(world, 'standard').map((p) => p.absorbance),
    'plotted absorbances against the measured means',
  ).toEqual(curve.levelMeans.filter((m): m is number => m !== null))
})

Then(
  'the concentration plotted against it is what the fit predicts for that reading',
  (world: World) => {
    const missing = pointsOfKind(world, 'standard').filter(
      (p) => p.fittedUgPerML === null || !Number.isFinite(p.fittedUgPerML),
    )
    expect(missing.map((p) => p.label), 'standards with no fitted concentration').toEqual([])
  },
)

Then('each standard point carries a recovery and no coefficient of variation', (world: World) => {
  for (const point of pointsOfKind(world, 'standard')) {
    expect(point.cvPercent, `${point.label} carried a CV, which is a sample's figure`).toBeNull()
    // The blank is the exception and has to be: recovery is a percentage of the nominal value,
    // and the blank's nominal value is zero.
    if (point.concUgPerML === 0) continue
    expect(point.recoveryPercent, `${point.label} carried no recovery`).not.toBeNull()
  }
})

Then('each sample point carries a coefficient of variation and no recovery', (world: World) => {
  const samples = pointsOfKind(world, 'sample')
  expect(samples.length, 'sample points to check').toBeGreaterThan(0)
  for (const point of samples) {
    expect(
      point.recoveryPercent,
      `${point.label} carried a recovery, which is a standard's figure`,
    ).toBeNull()
    expect(point.cvPercent, `${point.label} carried no CV`).not.toBeNull()
  }
})

Then('exactly one residual is marked', (world: World) => {
  expect(
    plot(world).points.filter((p) => p.residual).map((p) => p.label),
    'points marked with a residual',
  ).toHaveLength(1)
})

Then('it is marked at the {} ug\\/mL standard', (world: World, conc: string) => {
  const marked = plot(world).points.find((p) => p.residual) as PlotPoint
  expect(marked.concUgPerML, 'the standard whose recovery missed its band').toBe(number(conc))
})

Then("that sample's point is marked as out of range", (world: World) => {
  const name = world.outOfRangeSample as string
  const found = pointsOfKind(world, 'sample').find((p) => p.label === name)
  expect(found, `${name} was not plotted at all`).toBeDefined()
  expect((found as PlotPoint).inRange, `${name} was marked as inside the range`).toBe(false)
})

// --- Then: the path and the bounds ----------------------------------------

Then('the path runs from the lowest standard mean to the highest', (world: World) => {
  const drawn = plot(world)
  const means = pointsOfKind(world, 'standard').map((p) => p.absorbance)
  const first = drawn.path[0] as readonly [number, number]
  const last = drawn.path[drawn.path.length - 1] as readonly [number, number]
  expectAt(first[0], String(Math.min(...means)), 'the absorbance the path starts at')
  expectAt(last[0], String(Math.max(...means)), 'the absorbance the path ends at')
})

Then('the path stops at the highest standard mean', (world: World) => {
  // The sample sits beyond the end of the path, which is the whole reason the path stops there:
  // past the last standard the cubic is extrapolating, and drawing it would present that as
  // something the plate measured.
  const drawn = plot(world)
  const last = drawn.path[drawn.path.length - 1] as readonly [number, number]
  expect(last[0], 'the path was drawn past the standards').toBeLessThan(ABOVE_EVERY_STANDARD)
})

Then('the plotted concentration range includes zero', (world: World) => {
  const drawn = plot(world)
  expect(drawn.yMin, 'the bottom of the concentration axis').toBeLessThanOrEqual(0)
  expect(drawn.yMax, 'the top of the concentration axis').toBeGreaterThan(0)
})

Then("the plotted absorbance range reaches that sample's absorbance", (world: World) => {
  expect(plot(world).xMax, 'the right-hand end of the absorbance axis').toBeGreaterThanOrEqual(
    ABOVE_EVERY_STANDARD,
  )
})

Then('every plotted bound is a finite number', (world: World) => {
  const drawn = plot(world)
  const bounds = { xMin: drawn.xMin, xMax: drawn.xMax, yMin: drawn.yMin, yMax: drawn.yMax }
  const broken = Object.entries(bounds).filter(([, value]) => !Number.isFinite(value))
  expect(broken, 'bounds that are not finite numbers').toEqual([])
})

Then('no coordinate is NaN or Infinity', (world: World) => {
  const drawn = plot(world)
  const coordinates = [
    ...drawn.path.flatMap(([x, y]) => [x, y]),
    ...drawn.points.flatMap((p) => [p.absorbance, p.concUgPerML]),
  ]
  expect(
    coordinates.filter((n) => !Number.isFinite(n)),
    'coordinates that are not numbers',
  ).toEqual([])
})

// --- Then: what was left out, and whether it was accounted for ------------

Then('{string} is absent from the plotted points', (world: World, label: string) => {
  expect(plot(world).points.map((p) => p.label), 'the plotted labels').not.toContain(label)
})

Then('{string} is named in the omitted list', (world: World, label: string) => {
  expect(plot(world).omitted, 'the omitted list').toContain(label)
})

/** The label the plot gives the level whose replicates the curve feature emptied out. */
function droppedLabel(world: World): string {
  const conc = slot<number>(world, 'droppedConc')
  const level = fit(world).levels.find((l) => l.concUgPerML === conc)
  if (level === undefined) throw new Error(`no standard at ${conc} ug/mL in this scenario`)
  return level.tubeId ?? `${conc} µg/mL`
}

Then('that level is absent from the plotted points', (world: World) => {
  expect(plot(world).points.map((p) => p.label), 'the plotted labels').not.toContain(
    droppedLabel(world),
  )
})

Then('that level is named in the omitted list', (world: World) => {
  expect(plot(world).omitted, 'the omitted list').toContain(droppedLabel(world))
})

Then('the plot reports that it is not plottable', (world: World) => {
  expect(plot(world).plottable, 'a curve with no coefficients was reported as plottable').toBe(false)
})

Then('the plot holds no points', (world: World) => {
  expect(plot(world).points.map((p) => p.label), 'points from a curve that never fitted').toEqual([])
})
