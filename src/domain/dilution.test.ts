import { describe, expect, it } from 'vitest'
import { MANUAL_TABLE_1, STOCK, vial, type VialSpec } from './constants'
import { allDilutionIssues, dilutionInput, planDilutions } from './dilution'
import { IssueCode, Severity, hasCode } from './errors'
import { GOLDEN_DILUTION_ROWS, REFERENCE_DILUTION_INPUT } from './reference'

/**
 * Proves features/dilution/serial-dilution-plan.feature and
 * features/dilution/dilution-series-validation.feature.
 */

const codes = (plan: ReturnType<typeof planDilutions>): IssueCode[] =>
  allDilutionIssues(plan).map((i) => i.code)

const severityOf = (plan: ReturnType<typeof planDilutions>, code: IssueCode): Severity | null =>
  allDilutionIssues(plan).find((i) => i.code === code)?.severity ?? null

describe('the workbook golden fixture', () => {
  const plan = planDilutions(REFERENCE_DILUTION_INPUT)

  it('produces all nine rows', () => {
    expect(plan.vials).toHaveLength(9)
    expect(plan.ok).toBe(true)
  })

  it.each(GOLDEN_DILUTION_ROWS)('reproduces vial $vialId to 1e-12', (golden) => {
    const row = plan.vials.find((v) => v.vialId === golden.vialId)
    expect(row).toBeDefined()
    if (!row) return

    expect(row.finalConcUgPerML).toBe(golden.concUgPerML)
    expect(row.source).toBe(golden.source)

    if (golden.dilutionFactor === null) expect(row.dilutionFactor).toBeNull()
    else expect(row.dilutionFactor).toBeCloseTo(golden.dilutionFactor, 12)

    expect(row.volumeFromSourceUL).toBeCloseTo(golden.volumeFromSourceUL, 12)
    expect(row.volumeDiluentUL).toBeCloseTo(golden.volumeDiluentUL, 12)
    expect(row.totalVolumeUL).toBeCloseTo(golden.totalVolumeUL, 12)
    expect(row.leftoverUL).toBeCloseTo(golden.leftoverUL, 12)
  })

  it('reports nothing at all for a valid series', () => {
    expect(allDilutionIssues(plan)).toEqual([])
  })

  it('derives the volume to prepare from the well volume and replicate count', () => {
    expect(plan.volumeToPrepareUL).toBe(50)
  })
})

describe('inputs that scale the plan', () => {
  it('scales every total volume with the replicate count', () => {
    const three = planDilutions(dilutionInput({ nReplicates: 3 }))
    expect(three.volumeToPrepareUL).toBe(75)
    const reference = planDilutions(REFERENCE_DILUTION_INPUT)
    three.vials.forEach((row, i) => {
      const before = reference.vials[i]?.totalVolumeUL as number
      expect(row.totalVolumeUL).toBeCloseTo(before * 1.5, 12)
    })
  })

  it('prepares exactly the volume needed when the overage is removed', () => {
    const plan = planDilutions(dilutionInput({ overageFactor: 1 }))
    expect(plan.vials.find((v) => v.vialId === 'A')?.volumeFromSourceUL).toBeCloseTo(50, 12)
  })

  it('carries the manual Table 1 concentrations', () => {
    const plan = planDilutions(dilutionInput({ vials: MANUAL_TABLE_1 }))
    expect(plan.vials.map((v) => v.finalConcUgPerML)).toEqual([
      2000, 1500, 1000, 750, 500, 250, 125, 25, 0,
    ])
  })
})

describe('the leftover correction', () => {
  it('follows the source graph rather than row position', () => {
    // In the reference series C draws from A. Re-sourcing C from stock means nothing draws on
    // A at all, so A keeps its whole 105 uL. The workbook's I7 = H7 - F9 cannot express that.
    const rewired = REFERENCE_DILUTION_INPUT.vials.map((v) =>
      v.vialId === 'C' ? vial('C', 1000, STOCK) : v,
    )
    const plan = planDilutions(dilutionInput({ vials: rewired }))
    expect(plan.vials.find((v) => v.vialId === 'A')?.leftoverUL).toBeCloseTo(105, 12)
    expect(plan.vials.find((v) => v.vialId === 'C')?.volumeFromSourceUL).toBeCloseTo(52.5, 12)
  })

  it('reports a negative leftover rather than clipping it to zero', () => {
    const vials: VialSpec[] = [
      vial('A', 2000, STOCK),
      vial('B', 1000, 'A'),
      vial('C', 1000, 'A'),
      vial('D', 1000, 'A'),
      vial('Z', 0, null),
    ]
    const plan = planDilutions(dilutionInput({ vials }))
    const a = plan.vials.find((v) => v.vialId === 'A')
    expect(a?.leftoverUL).toBeLessThan(0)
    expect(hasCode(a?.issues ?? [], IssueCode.INSUFFICIENT_SOURCE_VOLUME)).toBe(true)
    expect(severityOf(plan, IssueCode.INSUFFICIENT_SOURCE_VOLUME)).toBe(Severity.ERROR)
  })
})

describe('ordering', () => {
  it('places every source before the vials drawing from it', () => {
    const shuffled: VialSpec[] = [
      vial('H', 25, 'G'),
      vial('G', 125, 'F'),
      vial('F', 250, 'E'),
      vial('E', 500, 'C'),
      vial('C', 1000, 'A'),
      vial('A', 2000, STOCK),
      vial('I', 0, null),
    ]
    const plan = planDilutions(dilutionInput({ vials: shuffled }))
    expect(plan.ok).toBe(true)
    // The rows come back in declared order; the guarantee is that the arithmetic resolved,
    // which it can only have done if the sources were visited first.
    for (const row of plan.vials) {
      if (row.source === null || row.source === STOCK) continue
      expect(row.dilutionFactor).not.toBeNull()
    }
  })
})

describe('pipetting limits', () => {
  it('flags a transfer below one microlitre', () => {
    // A 250x dilution of a 50 uL prep draws 0.42 uL even with the 2.1x overage.
    const vials: VialSpec[] = [vial('A', 2000, STOCK), vial('B', 8, 'A'), vial('I', 0, null)]
    const plan = planDilutions(dilutionInput({ vials }))
    const b = plan.vials.find((v) => v.vialId === 'B')
    expect(b?.volumeFromSourceUL).toBeLessThan(1)
    expect(hasCode(b?.issues ?? [], IssueCode.VOLUME_BELOW_PIPETTABLE)).toBe(true)
    expect(severityOf(plan, IssueCode.VOLUME_BELOW_PIPETTABLE)).toBe(Severity.WARN)
    expect(plan.vials).toHaveLength(3)
  })
})

describe('global input validation', () => {
  it.each([
    { field: 'stockConcUgPerUL', value: 0, code: IssueCode.NON_POSITIVE_STOCK },
    { field: 'stockConcUgPerUL', value: -2, code: IssueCode.NON_POSITIVE_STOCK },
    { field: 'volumePerWellUL', value: -5, code: IssueCode.NON_POSITIVE_VOLUME },
    { field: 'volumePerWellUL', value: 0, code: IssueCode.NON_POSITIVE_VOLUME },
    { field: 'nReplicates', value: 0, code: IssueCode.NON_POSITIVE_REPLICATES },
    { field: 'overageFactor', value: 0.5, code: IssueCode.OVERAGE_BELOW_ONE },
  ])('refuses $field of $value with $code', ({ field, value, code }) => {
    const plan = planDilutions(dilutionInput({ [field]: value }))
    expect(codes(plan)).toContain(code)
    expect(severityOf(plan, code)).toBe(Severity.ERROR)
    expect(plan.vials).toHaveLength(0)
    expect(plan.ok).toBe(false)
  })
})

describe('source graph validation', () => {
  const base = REFERENCE_DILUTION_INPUT.vials

  it('refuses an unknown source', () => {
    const vials = [...base.slice(0, 8), vial('J', 10, 'Z'), ...base.slice(8)]
    const plan = planDilutions(dilutionInput({ vials }))
    expect(codes(plan)).toContain(IssueCode.UNKNOWN_SOURCE)
    expect(plan.vials).toHaveLength(0)
  })

  it('refuses a cycle and terminates', () => {
    const vials: VialSpec[] = [vial('P', 100, 'Q'), vial('Q', 200, 'P'), vial('I', 0, null)]
    const plan = planDilutions(dilutionInput({ vials }))
    expect(codes(plan)).toContain(IssueCode.CIRCULAR_SOURCE)
    expect(plan.vials).toHaveLength(0)
  })

  it('refuses a vial that sources itself', () => {
    const vials: VialSpec[] = [vial('A', 100, 'A'), vial('I', 0, null)]
    expect(codes(planDilutions(dilutionInput({ vials })))).toContain(IssueCode.SELF_SOURCE)
  })

  it('refuses a duplicated vial id', () => {
    const vials: VialSpec[] = [vial('A', 2000, STOCK), vial('A', 1000, STOCK), vial('I', 0, null)]
    expect(codes(planDilutions(dilutionInput({ vials })))).toContain(IssueCode.DUPLICATE_VIAL_ID)
  })

  it('refuses a negative concentration', () => {
    const vials: VialSpec[] = [vial('A', -100, STOCK), vial('I', 0, null)]
    expect(codes(planDilutions(dilutionInput({ vials })))).toContain(
      IssueCode.NEGATIVE_CONCENTRATION,
    )
  })

  it('refuses an empty vial list', () => {
    const plan = planDilutions(dilutionInput({ vials: [] }))
    expect(codes(plan)).toContain(IssueCode.EMPTY_VIAL_LIST)
    expect(plan.vials).toHaveLength(0)
  })

  it('refuses a vial stronger than its source, keeping the rows so the bad one is visible', () => {
    const vials: VialSpec[] = [
      vial('A', 2000, STOCK),
      vial('B', 500, 'A'),
      vial('C', 1000, 'B'),
      vial('I', 0, null),
    ]
    const plan = planDilutions(dilutionInput({ vials }))
    const c = plan.vials.find((v) => v.vialId === 'C')
    expect(hasCode(c?.issues ?? [], IssueCode.CONCENTRATION_INCREASE)).toBe(true)
    expect(plan.vials).toHaveLength(4)
    expect(c?.dilutionFactor).toBeNull()
    expect(c?.totalVolumeUL).toBe(0)
    expect(plan.ok).toBe(false)
  })
})

describe('warnings that leave the plan usable', () => {
  it('warns about a blank that declares a source', () => {
    const vials = REFERENCE_DILUTION_INPUT.vials.map((v) =>
      v.vialId === 'I' ? vial('I', 0, 'G') : v,
    )
    const plan = planDilutions(dilutionInput({ vials }))
    expect(codes(plan)).toContain(IssueCode.BLANK_WITH_SOURCE)
    expect(severityOf(plan, IssueCode.BLANK_WITH_SOURCE)).toBe(Severity.WARN)
    expect(plan.vials).toHaveLength(9)
  })

  it('warns about a pointless one-to-one transfer', () => {
    const vials: VialSpec[] = [
      vial('A', 1000, STOCK),
      vial('B', 1000, 'A'),
      vial('I', 0, null),
    ]
    const plan = planDilutions(dilutionInput({ vials }))
    expect(codes(plan)).toContain(IssueCode.DILUTION_FACTOR_ONE_FROM_VIAL)
    expect(severityOf(plan, IssueCode.DILUTION_FACTOR_ONE_FROM_VIAL)).toBe(Severity.WARN)
    expect(plan.vials).toHaveLength(3)
  })
})

describe('hostile input', () => {
  it('returns issues rather than throwing', () => {
    const vials: VialSpec[] = [
      vial('', 100, STOCK),
      vial('☃', 50, '←'),
      vial('.,;', -1, ''),
      vial('A'.repeat(500), 0, null),
    ]
    expect(() => planDilutions(dilutionInput({ vials }))).not.toThrow()
    const plan = planDilutions(dilutionInput({ vials }))
    expect(plan.ok).toBe(false)
    expect(allDilutionIssues(plan).length).toBeGreaterThan(0)
  })
})
