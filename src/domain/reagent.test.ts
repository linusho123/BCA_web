import { describe, expect, it } from 'vitest'
import { PROCEDURES, Procedure } from './constants'
import { IssueCode, Severity } from './errors'
import { workingReagent } from './reagent'

/** Proves features/reagent/working-reagent.feature. */

const codesOf = (issues: readonly { code: IssueCode }[]) => issues.map((i) => i.code)

describe("the Pierce manual's worked example", () => {
  const wr = workingReagent({
    nStandards: 9,
    nUnknowns: 3,
    nReplicates: 2,
    procedure: Procedure.TEST_TUBE_STANDARD,
  })

  it('needs 24 wells and 48 mL', () => {
    expect(wr.nWells).toBe(24)
    expect(wr.totalVolumeUL).toBe(48000)
    expect(wr.totalVolumeML).toBe(48)
  })

  it('splits fifty to one and sums back to the total', () => {
    expect(wr.reagentAUL).toBeCloseTo(47058.82, 2)
    expect(wr.reagentBUL).toBeCloseTo(941.18, 2)
    expect(wr.reagentAUL + wr.reagentBUL).toBeCloseTo(wr.totalVolumeUL, 9)
    expect(wr.reagentAUL / wr.reagentBUL).toBeCloseTo(50, 9)
  })

  it('reports nothing', () => {
    expect(wr.issues).toEqual([])
  })
})

describe('the microplate procedures', () => {
  it('uses 200 uL of reagent per well', () => {
    const wr = workingReagent({ nStandards: 9, nUnknowns: 3, nReplicates: 2 })
    expect(wr.nWells).toBe(24)
    expect(wr.totalVolumeUL).toBe(4800)
  })

  it('fills exactly one plate without warning', () => {
    const wr = workingReagent({ nStandards: 9, nUnknowns: 39, nReplicates: 2 })
    expect(wr.nWells).toBe(96)
    expect(wr.totalVolumeUL).toBe(19200)
    expect(wr.issues).toEqual([])
  })

  it('warns past one plate and still gives the volume', () => {
    const wr = workingReagent({ nStandards: 9, nUnknowns: 45, nReplicates: 2 })
    expect(wr.nWells).toBe(108)
    expect(codesOf(wr.issues)).toContain(IssueCode.PLATE_OVERFLOW)
    expect(wr.issues[0]?.severity).toBe(Severity.WARN)
    expect(wr.totalVolumeUL).toBe(21600)
  })

  it('does not warn about plates for a test-tube procedure', () => {
    const wr = workingReagent({
      nStandards: 9,
      nUnknowns: 45,
      nReplicates: 2,
      procedure: Procedure.TEST_TUBE_STANDARD,
    })
    expect(codesOf(wr.issues)).not.toContain(IssueCode.PLATE_OVERFLOW)
  })
})

describe('the excess factor', () => {
  it('scales the total and leaves the split intact', () => {
    const wr = workingReagent({
      nStandards: 9,
      nUnknowns: 3,
      nReplicates: 2,
      excessFactor: 1.1,
    })
    expect(wr.baseVolumeUL).toBe(4800)
    expect(wr.totalVolumeUL).toBeCloseTo(5280, 9)
    expect(wr.reagentAUL + wr.reagentBUL).toBeCloseTo(wr.totalVolumeUL, 9)
  })

  it('stays visible as its own number, so the audit trail separates protocol from practice', () => {
    const wr = workingReagent({ nStandards: 9, nUnknowns: 3, nReplicates: 2, excessFactor: 1.1 })
    expect(wr.excessFactor).toBe(1.1)
    expect(wr.baseVolumeUL).not.toBe(wr.totalVolumeUL)
  })
})

describe('the procedure table', () => {
  it.each([
    { procedure: Procedure.MICROPLATE_STANDARD, sample: 25, reagent: 200, range: [20, 2000] },
    { procedure: Procedure.MICROPLATE_REDUCED_SAMPLE, sample: 10, reagent: 200, range: [125, 2000] },
    { procedure: Procedure.TEST_TUBE_STANDARD, sample: 100, reagent: 2000, range: [20, 2000] },
    { procedure: Procedure.TEST_TUBE_ENHANCED, sample: 100, reagent: 2000, range: [5, 250] },
  ])('carries the manual volumes for $procedure', ({ procedure, sample, reagent, range }) => {
    const spec = PROCEDURES[procedure]
    expect(spec.sampleVolumeUL).toBe(sample)
    expect(spec.wrVolumeUL).toBe(reagent)
    expect(spec.workingRangeUgPerML).toEqual(range)
  })

  it('states a ratio consistent with its own volumes', () => {
    for (const spec of Object.values(PROCEDURES)) {
      const [, stated] = spec.ratioLabel.split(':')
      expect(spec.wrVolumeUL / spec.sampleVolumeUL).toBeCloseTo(Number(stated), 9)
    }
  })
})

describe('refusals', () => {
  it('refuses a run with nothing in it', () => {
    const wr = workingReagent({ nStandards: 0, nUnknowns: 0, nReplicates: 2 })
    expect(codesOf(wr.issues)).toContain(IssueCode.NO_SAMPLES)
    expect(wr.totalVolumeUL).toBe(0)
  })

  it.each([
    { nStandards: 9, nUnknowns: -3, nReplicates: 2, code: IssueCode.NEGATIVE_COUNT },
    { nStandards: -1, nUnknowns: 3, nReplicates: 2, code: IssueCode.NEGATIVE_COUNT },
    { nStandards: 9, nUnknowns: 3, nReplicates: 0, code: IssueCode.NON_POSITIVE_REPLICATES },
    { nStandards: 9, nUnknowns: 3, nReplicates: -2, code: IssueCode.NON_POSITIVE_REPLICATES },
  ])('refuses $nStandards/$nUnknowns/$nReplicates with $code', (input) => {
    const wr = workingReagent(input)
    expect(codesOf(wr.issues)).toContain(input.code)
    expect(wr.totalVolumeUL).toBe(0)
  })

  it('refuses an excess factor below one', () => {
    const wr = workingReagent({
      nStandards: 9,
      nUnknowns: 3,
      nReplicates: 2,
      excessFactor: 0.8,
    })
    expect(codesOf(wr.issues)).toContain(IssueCode.EXCESS_BELOW_ONE)
    expect(wr.totalVolumeUL).toBe(0)
  })
})
