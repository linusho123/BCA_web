import { Given, Then, When } from 'quickpickle'
import { expect } from 'vitest'
import { MANUAL_TABLE_1, STOCK, type VialSpec, vial } from '~/domain/constants'
import {
  type DilutionInput,
  type DilutionPlan,
  type VialPlan,
  allDilutionIssues,
  dilutionInput,
  planDilutions,
} from '~/domain/dilution'
import { ratio } from '~/domain/format'
import { REFERENCE_DILUTION_INPUT } from '~/domain/reference'
import {
  type World,
  expectAt,
  expectIssue,
  expectNoErrors,
  expectNoIssues,
  numberList,
  slot,
} from '../support/world'

/**
 * Proves features/dilution/serial-dilution-plan.feature and
 * features/dilution/dilution-series-validation.feature.
 */

const input = (world: World): DilutionInput => slot<DilutionInput>(world, 'input')
const plan = (world: World): DilutionPlan => slot<DilutionPlan>(world, 'plan')

/** Every issue the plan raised, at the plan level and on the vials. */
const issues = (world: World) => allDilutionIssues(plan(world))

const vialRow = (world: World, id: string): VialPlan => {
  const found = plan(world).vials.find((v) => v.vialId === id)
  const present = plan(world).vials.map((v) => v.vialId).join(', ') || 'none'
  expect(found, `no vial "${id}" in the plan; it has: ${present}`).toBeDefined()
  return found as VialPlan
}

/** Rebuild the input with one option changed, keeping the vials the scenario has set up. */
const revise = (world: World, over: Partial<Parameters<typeof dilutionInput>[0]>): void => {
  const current = input(world)
  world.input = dilutionInput({
    stockConcUgPerUL: current.stockConcUgPerUL,
    volumePerWellUL: current.volumePerWellUL,
    nReplicates: current.nReplicates,
    overageFactor: current.overageFactor,
    vials: current.vials,
    ...over,
  })
}

Given('the reference dilution inputs', (world: World) => {
  world.input = REFERENCE_DILUTION_INPUT
})

Given('the manual Table 1 preset', (world: World) => {
  revise(world, { vials: MANUAL_TABLE_1 })
})

/**
 * The global inputs, named in the prose the features use for them.
 *
 * Written as a regular expression with the four names spelled out rather than as `the {} is {}`,
 * because a two-placeholder Cucumber expression starting with "the" also matches "the dilution
 * plan is built" and every other step of that shape.
 */
Given(
  /^the (stock strength|well volume|replicate count|overage factor) is (\S+)$/,
  (world: World, field: string, value: string) => {
    const n = Number(value)
    const byName: Record<string, Parameters<typeof revise>[1] | undefined> = {
      'stock strength': { stockConcUgPerUL: n },
      'well volume': { volumePerWellUL: n },
      'replicate count': { nReplicates: n },
      'overage factor': { overageFactor: n },
    }
    const over = byName[field]
    if (over === undefined) throw new Error(`"${field}" is not an input this app takes`)
    revise(world, over)
  },
)

// The third placeholder — the source being replaced — is left undeclared. It is in the sentence
// because the scenario reads better naming what it is changing away from, and reading it here
// would only let the step disagree with the series it is editing.
Given('vial {string} is sourced from {string} instead of {string}', (
  world: World,
  id: string,
  newSource: string,
) => {
  revise(world, {
    vials: input(world).vials.map((v) =>
      v.vialId === id ? vial(v.vialId, v.finalConcUgPerML, newSource) : v,
    ),
  })
})

Given('the vials are declared with each child before its source', (world: World) => {
  // Declaration order is a property of however the researcher typed the table, and the planner
  // is required to sort it into a pipetting order rather than to trust it.
  revise(world, { vials: [...input(world).vials].reverse() })
})

Given('a vial requiring a {} uL transfer from its source', (world: World, volumeUL: string) => {
  // volume from source = total / dilution factor, and total here is 105 uL, so a factor of
  // 262.5 asks for the 0.4 uL the scenario names. Below a P2's reliable range.
  const target = Number(volumeUL)
  const totalUL = 105
  const factor = totalUL / target
  world.tinyVialId = 'T'
  revise(world, {
    vials: [...input(world).vials, vial('T', 2000 / factor, 'A')],
  })
})

Given('vial {string} has three children each drawing {int} uL from it', (
  world: World,
  id: string,
  drawUL: number,
) => {
  // The reference series is replaced rather than added to, because attaching children to vial A
  // while leaving C sourced from it would make this scenario about two things at once.
  //
  // A holds 105 uL (50 uL to prepare, 2.1x overage). A child draws 105/factor uL, so a factor
  // of 1.75 draws the 60 uL the scenario names. Three of them want 180 uL from a vial that
  // holds 105: 75 uL short, and that shortfall is what must reach the leftover column.
  const parent = input(world).vials.find((v) => v.vialId === id) as VialSpec
  const totalUL = input(world).volumeToPrepareUL * input(world).overageFactor
  const childConc = parent.finalConcUgPerML / (totalUL / drawUL)
  revise(world, {
    vials: [
      vial(id, parent.finalConcUgPerML, STOCK),
      vial('X', childConc, id),
      vial('Y', childConc, id),
      vial('Z', childConc, id),
    ],
  })
})

Given('the series has {}', (world: World, defect: string) => {
  const vials = input(world).vials
  const defects: Record<string, readonly VialSpec[]> = {
    'a vial sourced from missing vial "Z"': [...vials, vial('N', 100, 'Z')],
    'vial "P" from "Q" and vial "Q" from "P"': [
      ...vials,
      vial('P', 100, 'Q'),
      vial('Q', 50, 'P'),
    ],
    'a vial listing itself as its source': [...vials, vial('S', 100, 'S')],
    'two vials both named "A"': [...vials, vial('A', 100, STOCK)],
    'a vial at -100 ug/mL': [...vials, vial('N', -100, STOCK)],
    'no vials at all': [],
    'a 0 ug/mL vial declaring a source': [...vials, vial('N', 0, 'A')],
    'a 1000 ug/mL vial from another at 1000': [...vials, vial('N', 1000, 'C')],
  }
  const replacement = defects[defect.trim()]
  if (replacement === undefined) throw new Error(`"${defect}" is not a defect this feature sets up`)
  revise(world, { vials: replacement })
})

Given('a {int} ug\\/mL vial sourced from a {int} ug\\/mL vial', (
  world: World,
  strong: number,
  weak: number,
) => {
  // A dilution cannot concentrate. The source here is vial E, which the reference series holds
  // at 500 ug/mL, so the new vial asks to come out stronger than what it was drawn from.
  const source = input(world).vials.find((v) => v.finalConcUgPerML === weak) as VialSpec
  world.namedVialId = 'N'
  revise(world, { vials: [...input(world).vials, vial('N', strong, source.vialId)] })
})

Given('a vial whose concentration was typed as {string}', (world: World, typed: string) => {
  // What arrives from an editable table is text. Number('1e3 ug') is NaN, and a NaN reaching
  // the planner would compute a whole series of NaN volumes rather than naming the cell.
  world.namedVialId = 'N'
  revise(world, {
    vials: [...input(world).vials, vial('N', Number(typed), STOCK)],
  })
})

// The NUL and the right-to-left override are written as escapes, not as literals. As literals
// they are the same string to the runtime and a binary file to git, which stops diffing this
// file at all — and a step file nobody can review by diff is worse than the hostile input is
// good. Keep them escaped.
Given('a series of vials with punctuation, unicode and empty names', (world: World) => {
  revise(world, {
    vials: [
      vial('', 100, STOCK),
      vial('  ', 50, ''),
      vial('A"; DROP TABLE', 25, '  '),
      vial('\u0000\u202E', -1, 'A"; DROP TABLE'),
      vial('🧪', NaN, '\u0000\u202E'),
      vial('A', Infinity, '🧪'),
    ],
  })
})

When('the dilution plan is built', (world: World) => {
  // The planner is required never to throw: a researcher mid-edit types a series through many
  // invalid intermediate states, and an exception would blank the panel rather than annotate it.
  try {
    world.plan = planDilutions(input(world))
    world.threw = false
  } catch (error) {
    world.threw = true
    world.thrown = error
  }
})

Then('the plan is:', (world: World, table: any) => {
  const rows = (table.hashes?.() ?? table.hashes) as Record<string, string>[]
  expect(plan(world).vials).toHaveLength(rows.length)
  rows.forEach((row, i) => {
    const got = plan(world).vials[i] as VialPlan
    expect(got.vialId, `row ${i + 1} vial id`).toBe(row.vial)
    expectAt(got.finalConcUgPerML, row.conc as string, `${row.vial} concentration`)
    expect(got.source ?? '', `${row.vial} source`).toBe(row.source ?? '')
    if ((row.factor ?? '') === '') {
      expect(got.dilutionFactor, `${row.vial} dilution factor`).toBeNull()
    } else {
      expectAt(got.dilutionFactor, row.factor as string, `${row.vial} dilution factor`)
    }
    expectAt(got.volumeFromSourceUL, row.from_source as string, `${row.vial} from source`)
    expectAt(got.volumeDiluentUL, row.diluent as string, `${row.vial} diluent`)
    expectAt(got.totalVolumeUL, row.total as string, `${row.vial} total`)
    expectAt(got.leftoverUL, row.leftover as string, `${row.vial} leftover`)
  })
})

Then('the volume to prepare is {} uL', (world: World, text: string) => {
  expectAt(plan(world).volumeToPrepareUL, text, 'volume to prepare')
})

Then("every vial's total volume is {} times its reference value", (
  world: World,
  factor: string,
) => {
  const reference = planDilutions(REFERENCE_DILUTION_INPUT)
  plan(world).vials.forEach((v, i) => {
    const before = reference.vials[i] as VialPlan
    expect(v.totalVolumeUL, `${v.vialId} total volume`).toBeCloseTo(
      before.totalVolumeUL * Number(factor),
      9,
    )
  })
})

Then('vial {string} has {} uL leftover', (world: World, id: string, text: string) => {
  expectAt(vialRow(world, id).leftoverUL, text, `vial ${id} leftover`)
})

Then('vial {string} draws {} uL from its source', (world: World, id: string, text: string) => {
  expectAt(vialRow(world, id).volumeFromSourceUL, text, `vial ${id} from source`)
})

Then('vial {string} is made up of {} uL of diluent', (world: World, id: string, text: string) => {
  expectAt(vialRow(world, id).volumeDiluentUL, text, `vial ${id} diluent`)
})

Then('vial {string} has no dilution factor', (world: World, id: string) => {
  // A blank is diluent only. Reporting a factor of 1 would claim it was drawn from something.
  expect(vialRow(world, id).dilutionFactor).toBeNull()
  expect(vialRow(world, id).source).toBeNull()
})

Then('vial {string} shows its dilution factor as {string}', (
  world: World,
  id: string,
  shown: string,
) => {
  // Asserted through `ratio`, the same function the table cell calls, so this scenario fails if
  // the display rule changes underneath it. Asserting against a hand-rounded number here would
  // leave the formatter itself unproven.
  const factor = vialRow(world, id).dilutionFactor
  expect(factor, `vial ${id} has no dilution factor to show`).not.toBeNull()
  expect(ratio(factor as number), `vial ${id} dilution factor as displayed`).toBe(shown)
})

Then('every vial appears after the vial it draws from', (world: World) => {
  const seen = new Set<string>([STOCK])
  for (const v of plan(world).vials) {
    if (v.source !== null) {
      expect(
        seen.has(v.source),
        `vial ${v.vialId} is listed before its source ${v.source}`,
      ).toBe(true)
    }
    seen.add(v.vialId)
  }
})

Then('the vial concentrations are {} ug\\/mL', (world: World, list: string) => {
  expect(plan(world).vials.map((v) => v.finalConcUgPerML)).toEqual(numberList(list))
})

Then('the plan reports no issues', (world: World) => {
  expectNoIssues(issues(world))
})

Then('the plan reports no issues at error severity', (world: World) => {
  expectNoErrors(issues(world))
})

Then('the plan reports issues at error severity', (world: World) => {
  expect(issues(world).filter((i) => i.severity === 'error').length).toBeGreaterThan(0)
})

Then('the plan is flagged {string} at {} severity', (
  world: World,
  code: string,
  level: string,
) => {
  expectIssue(issues(world), code, level)
})

Then('vial {string} is flagged {string} at {} severity', (
  world: World,
  id: string,
  code: string,
  level: string,
) => {
  const found = expectIssue(vialRow(world, id).issues, code, level, ` on vial ${id}`)
  expect(found.field, 'the issue names the vial it belongs to').toBe(id)
})

Then('that vial is flagged {string} at {} severity', (
  world: World,
  code: string,
  level: string,
) => {
  // "That vial" is the one the Given added, and the issue must be on the row rather than on the
  // plan: the planner marks a row, and a plan-level issue has no row to mark.
  const id = slot<string>(world, world.tinyVialId ? 'tinyVialId' : 'namedVialId')
  const found = expectIssue(vialRow(world, id).issues, code, level, ` on vial ${id}`)
  expect(found.field, 'the issue names the vial it belongs to').toBe(id)
})

Then('the plan still reports every vial', (world: World) => {
  // A warning leaves the table usable, and an error on one row still leaves the other rows
  // there — blanking the table would hide which row to fix.
  expect(plan(world).vials.length).toBe(input(world).vials.length)
})

Then('that vial has no volumes computed', (world: World) => {
  const row = vialRow(world, slot<string>(world, 'namedVialId'))
  expect(row.volumeFromSourceUL).toBe(0)
  expect(row.volumeDiluentUL).toBe(0)
})

Then('no vial rows are produced', (world: World) => {
  expect(plan(world).vials).toEqual([])
})

Then('vial {string} has a negative leftover recorded rather than a clipped zero', (
  world: World,
  id: string,
) => {
  // The shortfall is the actionable number: clipping it to zero would say "none left" where
  // the truth is "75 uL short", and those call for different actions at the bench.
  expect(vialRow(world, id).leftoverUL).toBeLessThan(0)
})

Then('no exception escapes the planner', (world: World) => {
  expect(world.threw, `the planner threw: ${String(world.thrown)}`).toBe(false)
})
