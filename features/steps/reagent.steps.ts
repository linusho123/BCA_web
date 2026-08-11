import { Given, Then, When } from 'quickpickle'
import { expect } from 'vitest'
import { PROCEDURES, type ProcedureSpec } from '~/domain/constants'
import { type WorkingReagent, workingReagent } from '~/domain/reagent'
import {
  type World,
  expectAt,
  expectIssue,
  expectNoIssues,
  procedure,
  slot,
} from '../support/world'

/** Proves features/reagent/working-reagent.feature. */

const reagent = (world: World): WorkingReagent => slot<WorkingReagent>(world, 'reagent')

Given(
  '{int} standards, {int} unknowns and {int} replicates',
  (world: World, nStandards: number, nUnknowns: number, nReplicates: number) => {
    world.counts = { nStandards, nUnknowns, nReplicates }
  },
)

Given('the {string} procedure', (world: World, label: string) => {
  world.procedure = procedure(label)
})

Given(
  'the {string} procedure with an excess factor of {}',
  (world: World, label: string, factor: string) => {
    world.procedure = procedure(label)
    world.excessFactor = Number(factor)
  },
)

When('the working reagent is calculated', (world: World) => {
  const counts = slot<{ nStandards: number; nUnknowns: number; nReplicates: number }>(
    world,
    'counts',
  )
  world.reagent = workingReagent({
    ...counts,
    procedure: slot(world, 'procedure'),
    excessFactor: (world.excessFactor as number | undefined) ?? 1,
  })
})

When('its definition is read', (world: World) => {
  world.spec = PROCEDURES[slot<keyof typeof PROCEDURES>(world, 'procedure')]
})

Then('{int} wells are required', (world: World, expected: number) => {
  expect(reagent(world).nWells).toBe(expected)
})

Then('the total volume is {} uL', (world: World, text: string) => {
  expectAt(reagent(world).totalVolumeUL, text, 'total volume')
})

Then('reagent A is {} uL', (world: World, text: string) => {
  expectAt(reagent(world).reagentAUL, text, 'reagent A')
})

Then('reagent B is {} uL', (world: World, text: string) => {
  expectAt(reagent(world).reagentBUL, text, 'reagent B')
})

Then('the two reagents sum to the total volume', (world: World) => {
  // The split is what gets pipetted; if the parts do not sum to the whole, one of the three
  // numbers on screen is wrong and there is no way to tell which from the bench.
  const r = reagent(world)
  expect(r.reagentAUL + r.reagentBUL).toBeCloseTo(r.totalVolumeUL, 9)
})

Then('the calculation reports no issues', (world: World) => {
  expectNoIssues(reagent(world).issues)
})

Then(
  'the calculation is flagged {string} at {} severity',
  (world: World, code: string, level: string) => {
    expectIssue(reagent(world).issues, code, level)
  },
)

Then('the sample volume is {int} uL', (world: World, expected: number) => {
  expect(slot<ProcedureSpec>(world, 'spec').sampleVolumeUL).toBe(expected)
})

Then('the reagent volume is {int} uL', (world: World, expected: number) => {
  expect(slot<ProcedureSpec>(world, 'spec').wrVolumeUL).toBe(expected)
})

Then(
  'the working range is {int} to {int} ug\\/mL',
  (world: World, low: number, high: number) => {
    expect(slot<ProcedureSpec>(world, 'spec').workingRangeUgPerML).toEqual([low, high])
  },
)
