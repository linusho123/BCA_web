import { Given, Then, When } from 'quickpickle'
import { expect } from 'vitest'
import { type ReplicateStats, replicateStats } from '~/domain/qc'
import {
  type World,
  expectAt,
  expectIssue,
  expectNoIssues,
  replicateList,
  slot,
} from '../support/world'

/** Proves features/qc/replicate-statistics.feature. */

const stats = (world: World): ReplicateStats => slot<ReplicateStats>(world, 'stats')

Given('the replicates {}', (world: World, values: string) => {
  world.replicates = replicateList(values)
})

Given('ten arbitrary replicate values', (world: World) => {
  // Deliberately untidy: a tidy set can pass a mean that is really a median, and a set with no
  // repeats can pass a standard deviation computed with the wrong denominator.
  world.replicates = [0.132, 0.4, 0.41, 0.395, 0.72, 0.719, 1.05, 1.4, 1.401, 2.051]
})

Given('replicates whose coefficient of variation is exactly 15 percent', (world: World) => {
  // cv% = 100 * |b - a| / (sqrt(2) * mean) for a pair, so this spread about a mean of 1 lands
  // on 15 to within a part in 1e15. The number system has no double that sits exactly on the
  // boundary, so "exactly 15 percent" means the closest a pair can get from below.
  const spread = (15 * Math.SQRT2) / 100 / 2
  world.replicates = [1 - spread * (1 - 1e-12), 1 + spread * (1 - 1e-12)]
})

When('the replicate statistics are computed', (world: World) => {
  world.stats = replicateStats(slot<(number | null)[]>(world, 'replicates'))
})

Then('the count is {int}', (world: World, expected: number) => {
  expect(stats(world).n).toBe(expected)
})

Then('the mean is {}', (world: World, text: string) => {
  const value = stats(world).mean
  if (text.trim() === 'absent') {
    expect(value).toBeNull()
    return
  }
  expectAt(value, text, 'mean')
})

Then('the standard deviation is {}', (world: World, text: string) => {
  const value = stats(world).sd
  if (text.trim() === 'absent') {
    expect(value).toBeNull()
    return
  }
  expectAt(value, text, 'standard deviation')
})

Then('the coefficient of variation is absent', (world: World) => {
  // Absent, not zero: a CV of zero is a claim about tight replicates, and there is no such
  // claim to make when the mean it would be divided by is zero.
  expect(stats(world).cvPercent).toBeNull()
})

Then('the coefficient of variation is {} percent', (world: World, text: string) => {
  expectAt(stats(world).cvPercent, text, 'coefficient of variation')
})

Then(
  'the mean and standard deviation match the sample statistics of those values',
  (world: World) => {
    // Recomputed here from the definitions rather than from a stored fixture, so this scenario
    // catches a change of denominator that a golden number would hide.
    const values = slot<(number | null)[]>(world, 'replicates').filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v),
    )
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance =
      values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1)
    expect(stats(world).mean as number).toBeCloseTo(mean, 12)
    expect(stats(world).sd as number).toBeCloseTo(Math.sqrt(variance), 12)
  },
)

Then(
  'the statistics are flagged {string} at {} severity',
  (world: World, code: string, level: string) => {
    expectIssue(stats(world).issues, code, level)
  },
)

Then('no quality flag is raised', (world: World) => {
  expectNoIssues(stats(world).issues)
})

Then('no other quality flag is raised', (world: World) => {
  // The fail band replaces the warn band rather than joining it, so exactly one flag is right.
  expect(stats(world).issues).toHaveLength(1)
})
