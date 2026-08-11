import { Given, Then } from 'quickpickle'
import { expect } from 'vitest'

/**
 * QuickPickle step signature: (world, ...capturedParams)
 *
 * The world object comes FIRST. This differs from CucumberJS, where the world is `this`.
 * Getting it wrong produces `undefined` parameters and is the most common mistake here.
 *
 * `world` is fresh per scenario, so scenarios stay independent by default.
 */

Given('a/another number {int}', (world: any, n: number) => {
  world.numbers = [...(world.numbers ?? []), n]
})

Then('the sum should be {int}', (world: any, expected: number) => {
  const sum = (world.numbers as number[]).reduce((a, b) => a + b, 0)
  expect(sum).toBe(expected)
})

Then('the sum should not be {int}', (world: any, expected: number) => {
  const sum = (world.numbers as number[]).reduce((a, b) => a + b, 0)
  expect(sum).not.toBe(expected)
})
