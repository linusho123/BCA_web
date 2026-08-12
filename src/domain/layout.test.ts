import { describe, expect, it } from 'vitest'
import { StandardsDirection, directionLabel, standardSeries } from './constants'
import { IssueCode, Severity, hasCode, hasErrors } from './errors'
import {
  checkOverlap,
  defaultLayout,
  mapSamples,
  mapStandards,
  parseRegion,
  wellLabel,
  wellsToRegion,
} from './layout'
import { parsePlate } from './plate'
import {
  REFERENCE_ABSORBANCES,
  REFERENCE_CONCENTRATIONS,
  REFERENCE_TUBE_IDS,
  referencePlateText,
} from './reference'

/** Proves features/plate/well-region-mapping.feature and features/plate/default-plate-layout.feature. */

const codesOf = (issues: readonly { code: IssueCode }[]) => issues.map((i) => i.code)

const PLATE = parsePlate(referencePlateText())

/**
 * The reference series as the *plate* holds it: most concentrated in column 1, descending to the
 * blank in column 9. The `REFERENCE_*` constants are in the workbook's ascending order, which is
 * the reverse; pairing those directly with `PLATE` pairs every well with the wrong tube, which is
 * exactly the defect `default-plate-layout.feature` AC7 now pins.
 */
const PLATE_CONCENTRATIONS = [...REFERENCE_CONCENTRATIONS].reverse()
const PLATE_ABSORBANCES = [...REFERENCE_ABSORBANCES].reverse()
const PLATE_TUBE_IDS = [...REFERENCE_TUBE_IDS].reverse()

describe('wellLabel', () => {
  it.each([
    ['a', 3, 'A3'],
    [' B ', 12, 'B12'],
    ['H', 1, 'H1'],
  ])('spells (%j, %d) as %s', (row, column, expected) => {
    expect(wellLabel(row, column)).toBe(expected)
  })
})

describe('parseRegion', () => {
  it('expands a span along a row', () => {
    expect(parseRegion('A1:A9').wells).toEqual([
      'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9',
    ])
  })

  it('expands a span down a column', () => {
    expect(parseRegion('A1:D1').wells).toEqual(['A1', 'B1', 'C1', 'D1'])
  })

  it('walks a reversed span in the order it was written', () => {
    expect(parseRegion('A3:A1').wells).toEqual(['A3', 'A2', 'A1'])
    expect(parseRegion('C1:A1').wells).toEqual(['C1', 'B1', 'A1'])
  })

  it('accepts a list, a span, and a mixture of the two', () => {
    expect(parseRegion('A1, A2, A3').wells).toEqual(['A1', 'A2', 'A3'])
    expect(parseRegion('A1:A3, C1').wells).toEqual(['A1', 'A2', 'A3', 'C1'])
  })

  it('is indifferent to case and spacing', () => {
    expect(parseRegion(' a1 : a3 ,  c1 ').wells).toEqual(['A1', 'A2', 'A3', 'C1'])
  })

  it('collapses a well repeated inside one region', () => {
    // A repeat within a region is a typo, not a claim about replicates; counting it twice would
    // double-weight that well in the mean.
    const parsed = parseRegion('A1, A1, A2')
    expect(parsed.wells).toEqual(['A1', 'A2'])
    expect(parsed.issues).toEqual([])
  })

  it.each([
    ['an empty region', ''],
    ['only separators', ' , , '],
  ])('refuses %s', (_name, text) => {
    const parsed = parseRegion(text)
    expect(parsed.wells).toEqual([])
    expect(codesOf(parsed.issues)).toEqual([IssueCode.EMPTY_REGION])
    expect(hasErrors(parsed.issues)).toBe(true)
  })

  it.each([
    ['a rectangle', 'A1:B9'],
    ['a token that is not a well', 'hello'],
    ['a row with no column', 'A'],
    ['a column with no row', '12'],
    ['a two-letter row', 'AA1'],
    ['column zero', 'A0'],
    ['a half-written span', 'A1:'],
  ])('refuses %s naming what was wrong', (_name, text) => {
    const parsed = parseRegion(text)
    expect(parsed.wells).toEqual([])
    expect(hasCode(parsed.issues, IssueCode.BAD_REGION_SYNTAX)).toBe(true)
    expect(parsed.issues[0]?.severity).toBe(Severity.ERROR)
  })

  it('refuses a span longer than any plate rather than expanding it', () => {
    // A1:A100000 is one keystroke from A1:A10, and expanding it eagerly inside a reactive chain
    // would build a hundred thousand labels on every keystroke.
    const parsed = parseRegion('A1:A100000')
    expect(parsed.wells).toEqual([])
    expect(hasCode(parsed.issues, IssueCode.BAD_REGION_SYNTAX)).toBe(true)
    expect(parsed.issues[0]?.message).toContain('100000')
  })

  it('keeps the good part of a partly bad list and reports the rest', () => {
    const parsed = parseRegion('A1:A3, oops, C1')
    expect(parsed.wells).toEqual(['A1', 'A2', 'A3', 'C1'])
    expect(hasCode(parsed.issues, IssueCode.BAD_REGION_SYNTAX)).toBe(true)
  })
})

describe('wellsToRegion', () => {
  it.each([
    [['A1', 'A2', 'A3'], 'A1:A3'],
    [['A1'], 'A1'],
    [['A1', 'A3'], 'A1, A3'],
    [['A1', 'A2', 'A4', 'A5'], 'A1:A2, A4:A5'],
    [['C1', 'C2', 'C3', 'D1'], 'C1:C3, D1'],
  ])('names %j as %s', (wells, expected) => {
    expect(wellsToRegion(wells)).toBe(expected)
  })

  it('orders by row then column, not by the order the wells were clicked', () => {
    expect(wellsToRegion(['C3', 'C1', 'C2', 'A1'])).toBe('A1, C1:C3')
  })

  it('collapses a well selected twice', () => {
    expect(wellsToRegion(['A1', 'a1', ' A1 '])).toBe('A1')
  })

  it.each([
    [['A1', 'A2', 'A3']],
    [['C1', 'C2', 'C3', 'D1', 'D2']],
    [['A1', 'A3', 'A5', 'H12']],
  ])('round-trips %j through parseRegion', (wells) => {
    const round = parseRegion(wellsToRegion(wells)).wells
    expect([...round].sort()).toEqual([...new Set(wells)].sort())
  })

  it('passes a token that is not a well through rather than dropping it', () => {
    // Dropping it here would make it vanish silently; passed through, parseRegion reports it.
    const region = wellsToRegion(['A1', 'oops'])
    expect(region).toContain('oops')
    expect(hasCode(parseRegion(region).issues, IssueCode.BAD_REGION_SYNTAX)).toBe(true)
  })

  it('names nothing for an empty selection', () => {
    expect(wellsToRegion([])).toBe('')
    expect(wellsToRegion(['', '  '])).toBe('')
  })
})

describe('mapStandards', () => {
  it('reads the workbook standards off the reference plate', () => {
    const { levels, issues } = mapStandards(PLATE, ['A1:A9'], PLATE_CONCENTRATIONS, {
      tubeIds: PLATE_TUBE_IDS,
    })
    expect(issues).toEqual([])
    expect(levels).toHaveLength(9)
    expect(levels.map((l) => l.concUgPerML)).toEqual(PLATE_CONCENTRATIONS)
    expect(levels.map((l) => l.replicates[0])).toEqual(PLATE_ABSORBANCES)
    expect(levels.map((l) => l.tubeId)).toEqual(PLATE_TUBE_IDS)
    // The top of the series is in column 1, where the bench pipettes it.
    expect(levels[0]?.concUgPerML).toBe(2000)
    expect(levels[8]?.concUgPerML).toBe(0)
  })

  it('treats a second region as a second read of every level', () => {
    const { levels } = mapStandards(PLATE, ['A1:A9', 'B1:B9'], PLATE_CONCENTRATIONS)
    expect(levels[0]?.replicates).toEqual([2.051, 2.051])
    expect(levels[8]?.replicates).toEqual([0.132, 0.132])
  })

  it('pairs the nth well with the nth concentration, whichever way the series runs', () => {
    // Walking the row backwards with the concentrations backwards too must reach the same
    // pairing: the mapping follows the region's order and holds no opinion of its own.
    const { levels } = mapStandards(PLATE, ['A9:A1'], REFERENCE_CONCENTRATIONS)
    expect(levels[0]?.concUgPerML).toBe(0)
    expect(levels[0]?.replicates).toEqual([0.132])
    expect(levels[8]?.concUgPerML).toBe(2000)
    expect(levels[8]?.replicates).toEqual([2.051])
  })

  it('refuses a region whose length does not match the concentration count', () => {
    const { levels, issues } = mapStandards(PLATE, ['A1:A5'], REFERENCE_CONCENTRATIONS)
    expect(levels).toEqual([])
    const found = issues.find((i) => i.code === IssueCode.REGION_LENGTH_MISMATCH)
    expect(found?.severity).toBe(Severity.ERROR)
    expect(found?.message).toContain('5')
    expect(found?.message).toContain('9')
  })

  it('withholds every level when any region is off the plate', () => {
    // A curve fitted from phantom wells is worse than no curve: it is plausible and wrong.
    const { levels, issues } = mapStandards(PLATE, ['A1:A8, Z1'], REFERENCE_CONCENTRATIONS)
    expect(levels).toEqual([])
    expect(hasCode(issues, IssueCode.REGION_OUT_OF_BOUNDS)).toBe(true)
  })

  it('refuses when no concentrations were given', () => {
    const { levels, issues } = mapStandards(PLATE, ['A1:A9'], [])
    expect(levels).toEqual([])
    expect(codesOf(issues)).toEqual([IssueCode.EMPTY_INPUT])
  })

  it('refuses when no region survives parsing', () => {
    const { levels, issues } = mapStandards(PLATE, ['nonsense'], REFERENCE_CONCENTRATIONS)
    expect(levels).toEqual([])
    expect(hasCode(issues, IssueCode.BAD_REGION_SYNTAX)).toBe(true)
    expect(hasErrors(issues)).toBe(true)
  })

  it('keeps an unreadable well as an absent replicate rather than withholding the fit', () => {
    // A blank well is data about the read, not a mistake in the layout, so the curve still fits.
    // 0.262 is the 125 ug/mL tube, which the plate holds in column 7 — the row runs down from
    // 2000, so the hole is not where the workbook's ascending list would put it.
    const holed = parsePlate(referencePlateText().replace('0.262', '-'))
    const { levels, issues } = mapStandards(holed, ['A1:A9'], PLATE_CONCENTRATIONS)
    expect(levels).toHaveLength(9)
    expect(levels[6]?.concUgPerML).toBe(125)
    expect(levels[6]?.replicates).toEqual([null])
    expect(hasCode(issues, IssueCode.UNREADABLE_WELL_IN_REGION)).toBe(true)
    expect(hasErrors(issues)).toBe(false)
  })
})

describe('mapSamples', () => {
  it('reads each sample from its own row', () => {
    const { samples, issues } = mapSamples(PLATE, [
      ['MCF7', 'C1:C3'],
      ['RPMI8226', 'D1:D3'],
    ])
    expect(issues).toEqual([])
    expect(samples).toEqual([
      { name: 'MCF7', replicates: [0.43, 0.43, 0.43] },
      { name: 'RPMI8226', replicates: [0.36, 0.36, 0.36] },
    ])
  })

  it('accepts a region of any length, because every well is a replicate of the one sample', () => {
    const { samples, issues } = mapSamples(PLATE, [['MCF7', 'C1']])
    expect(samples[0]?.replicates).toEqual([0.43])
    expect(issues).toEqual([])
  })

  it('skips one bad sample and still maps its neighbours', () => {
    const { samples, issues } = mapSamples(PLATE, [
      ['MCF7', 'C1:C3'],
      ['Broken', 'nonsense'],
      ['RPMI8226', 'D1:D3'],
    ])
    expect(samples.map((s) => s.name)).toEqual(['MCF7', 'RPMI8226'])
    expect(hasCode(issues, IssueCode.BAD_REGION_SYNTAX)).toBe(true)
  })

  it('refuses an unnamed sample rather than inventing a name for it', () => {
    const { samples, issues } = mapSamples(PLATE, [['   ', 'C1:C3']])
    expect(samples).toEqual([])
    expect(codesOf(issues)).toEqual([IssueCode.UNNAMED_SAMPLE])
    expect(issues[0]?.severity).toBe(Severity.ERROR)
  })

  it('reports a well outside the plate against the sample that claimed it', () => {
    const { issues } = mapSamples(PLATE, [['MCF7', 'C1:C3, Z9']])
    const found = issues.find((i) => i.code === IssueCode.REGION_OUT_OF_BOUNDS)
    expect(found?.severity).toBe(Severity.ERROR)
    expect(found?.message).toContain('Z9')
  })

  it('distinguishes an unreadable well from one that is off the plate', () => {
    const { samples, issues } = mapSamples(PLATE, [['MCF7', 'C1:C4']])
    // C4 was never plated: the region is wrong by one, but the instrument is not at fault.
    expect(samples[0]?.replicates).toEqual([0.43, 0.43, 0.43, null])
    expect(hasCode(issues, IssueCode.UNREADABLE_WELL_IN_REGION)).toBe(true)
    expect(hasCode(issues, IssueCode.REGION_OUT_OF_BOUNDS)).toBe(false)
  })
})

describe('defaultLayout', () => {
  it('maps the plate this assay is actually run on without being told the layout', () => {
    const layout = defaultLayout(PLATE, ['MCF7', 'RPMI8226'])
    expect(layout.standardRegions).toEqual(['A1:A9', 'B1:B9'])
    expect(layout.assignments).toEqual([
      ['MCF7', 'C1:C3'],
      ['RPMI8226', 'D1:D3'],
    ])
    expect(layout.issues).toEqual([])
  })

  it('feeds straight into the mapping functions it names', () => {
    const layout = defaultLayout(PLATE, ['MCF7', 'RPMI8226'])
    const standards = mapStandards(PLATE, layout.standardRegions, REFERENCE_CONCENTRATIONS)
    const samples = mapSamples(PLATE, layout.assignments)
    expect(standards.levels).toHaveLength(9)
    expect(samples.samples).toHaveLength(2)
    expect(checkOverlap(layout.standardRegions, layout.assignments)).toEqual([])
  })

  it('leaves row B out of the standards when it holds no reading', () => {
    // A single-read plate is the ordinary case; a row of nine nulls averaged into every level
    // would make a clean read look half missing.
    const single = parsePlate(
      referencePlateText()
        .split('\n')
        .map((line, i) => (i === 1 ? Array<string>(12).fill('-').join('\t') : line))
        .join('\n'),
    )
    const layout = defaultLayout(single, ['MCF7'])
    expect(layout.standardRegions).toEqual(['A1:A9'])
  })

  it('leaves row A out too when it holds no reading', () => {
    const noStandards = parsePlate(
      referencePlateText()
        .split('\n')
        .map((line, i) => (i < 2 ? Array<string>(12).fill('-').join('\t') : line))
        .join('\n'),
    )
    expect(defaultLayout(noStandards, ['MCF7']).standardRegions).toEqual([])
  })

  it('takes each sample width from what was actually plated', () => {
    const wider = referencePlateText().replace(
      '0.43\t0.43\t0.43\t-',
      '0.43\t0.43\t0.43\t0.43\t0.43\t0.43\t-'.slice(0, -2),
    )
    const layout = defaultLayout(parsePlate(wider), ['MCF7'])
    expect(layout.assignments[0]?.[1]).toBe('C1:C6')
  })

  it('stops a sample row at its first gap rather than spanning it', () => {
    // Three replicates in C1:C3 and a stray note in C7 is a plate with three replicates.
    const gapped = parsePlate('0.1\t0.2\n0.1\t0.2\n0.43\t0.43\t-\t-\t-\t-\t0.9')
    const layout = defaultLayout(gapped, ['MCF7'], { nStandards: 2 })
    expect(layout.assignments[0]?.[1]).toBe('C1:C2')
  })

  it('holds a row open for a blank name rather than sliding the rest up', () => {
    // Sliding up would map a sample onto another sample's wells and report nothing at all.
    const layout = defaultLayout(PLATE, ['', 'RPMI8226'])
    expect(layout.assignments).toEqual([['RPMI8226', 'D1:D3']])
  })

  it('refuses to place more samples than the plate has rows below the standards', () => {
    const names = Array.from({ length: 8 }, (_, i) => `S${i + 1}`)
    const layout = defaultLayout(PLATE, names)
    const found = layout.issues.find((i) => i.code === IssueCode.REGION_OUT_OF_BOUNDS)
    expect(found?.severity).toBe(Severity.ERROR)
    expect(found?.message).toContain('S7')
  })

  it('warns rather than mapping a sample onto a row with nothing in it', () => {
    const layout = defaultLayout(PLATE, ['MCF7', 'RPMI8226', 'Ghost'])
    const found = layout.issues.find((i) => i.code === IssueCode.UNREADABLE_WELL_IN_REGION)
    expect(found?.severity).toBe(Severity.WARN)
    expect(found?.message).toContain('Ghost')
    expect(layout.assignments.map(([n]) => n)).toEqual(['MCF7', 'RPMI8226'])
  })
})

describe('checkOverlap', () => {
  it('says nothing about a layout that does not overlap', () => {
    expect(checkOverlap(['A1:A9'], [['MCF7', 'C1:C3']])).toEqual([])
  })

  it('names a well claimed by both a standard and a sample', () => {
    const issues = checkOverlap(['A1:A9'], [['MCF7', 'A1:A3']])
    expect(issues).toHaveLength(3)
    expect(issues[0]?.code).toBe(IssueCode.OVERLAPPING_REGIONS)
    expect(issues[0]?.severity).toBe(Severity.ERROR)
    expect(issues[0]?.message).toContain('A1')
    expect(issues[0]?.message).toContain('MCF7')
  })

  it('names a well claimed by two samples', () => {
    const issues = checkOverlap([], [
      ['MCF7', 'C1:C3'],
      ['RPMI8226', 'C3:C5'],
    ])
    expect(issues.map((i) => i.message.match(/well (\w+)/)?.[1])).toEqual(['C3'])
  })

  it('names a well claimed by two standard replicates', () => {
    const issues = checkOverlap(['A1:A9', 'A1:A9'], [])
    expect(issues).toHaveLength(9)
    expect(issues[0]?.message).toContain('replicate 1')
    expect(issues[0]?.message).toContain('replicate 2')
  })

  it('reports overlaps in well order, so the same layout always reads the same way', () => {
    const issues = checkOverlap(['A1:A3'], [['S', 'A3, A1']])
    expect(issues.map((i) => i.message.match(/well (\w+)/)?.[1])).toEqual(['A1', 'A3'])
  })
})

/**
 * Proves the domain half of features/analysis/standards-direction.feature.
 *
 * The mapping is exercised here rather than the constant read back, for the same reason AC7 is:
 * `standardSeries(ASCENDING).concentrations` equalling the reversed list is the function
 * agreeing with itself. What has to be true is that the nth well ends up paired with the nth
 * concentration *and* the nth tube, which only mapStandards can answer.
 */
describe('standardSeries', () => {
  const map = (direction: StandardsDirection) => {
    const series = standardSeries(direction)
    return mapStandards(PLATE, ['A1:A9'], series.concentrations, { tubeIds: series.tubeIds })
  }

  it('pairs column 1 with the most concentrated tube by default', () => {
    const { levels, issues } = map(StandardsDirection.DESCENDING)
    expect(hasErrors(issues)).toBe(false)
    expect(levels[0]?.concUgPerML).toBe(2000)
    expect(levels[0]?.tubeId).toBe('A')
    expect(levels[0]?.replicates).toEqual([PLATE_ABSORBANCES[0]])
    expect(levels[8]?.concUgPerML).toBe(0)
    expect(levels[8]?.tubeId).toBe('I')
  })

  it('pairs column 1 with the blank when the plate was pipetted the other way', () => {
    const { levels, issues } = map(StandardsDirection.ASCENDING)
    expect(hasErrors(issues)).toBe(false)
    expect(levels[0]?.concUgPerML).toBe(0)
    expect(levels[0]?.tubeId).toBe('I')
    expect(levels[0]?.replicates).toEqual([PLATE_ABSORBANCES[0]])
    expect(levels[8]?.concUgPerML).toBe(2000)
    expect(levels[8]?.tubeId).toBe('A')
  })

  it('reverses the tube letters with the concentrations, never one alone', () => {
    const ascending = standardSeries(StandardsDirection.ASCENDING)
    const descending = standardSeries(StandardsDirection.DESCENDING)
    expect([...ascending.concentrations].reverse()).toEqual([...descending.concentrations])
    expect([...ascending.tubeIds].reverse()).toEqual([...descending.tubeIds])
  })

  it('keeps every standard, rather than losing one off the reversed end', () => {
    const { levels } = map(StandardsDirection.ASCENDING)
    expect(levels).toHaveLength(PLATE_CONCENTRATIONS.length)
    expect(new Set(levels.map((l) => l.tubeId)).size).toBe(PLATE_TUBE_IDS.length)
  })

  it('does not mutate the constant it reverses', () => {
    standardSeries(StandardsDirection.ASCENDING)
    expect(standardSeries(StandardsDirection.DESCENDING).concentrations[0]).toBe(2000)
  })

  it('names each direction for a reader', () => {
    expect(directionLabel(StandardsDirection.DESCENDING)).toBe('Descending')
    expect(directionLabel(StandardsDirection.ASCENDING)).toBe('Ascending')
  })
})
