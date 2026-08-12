/**
 * Steps for features/analysis/plate-file-import.feature.
 *
 * Files are handed to the state action as decoded text rather than driven through the file
 * input. A browser will not let a test put a real file on an `<input type="file">` without a
 * fixture on disk, and what these scenarios are about is what the app does with a file's
 * contents — the shape it accepts, the shapes it refuses, and what it leaves alone when it
 * refuses. The input element's own wiring is covered by driving the built app in a browser.
 */

import { expect } from 'vitest'
import { Given, Then, When } from 'quickpickle'
import { REFERENCE_ABSORBANCES, referencePlateText } from '~/domain/reference'
import * as analysis from '~/state/analysis'
import { mountOnce, one, settle } from './support'

/**
 * A grid of the given shape, built from the workbook's own absorbances.
 *
 * Column c holds the cth reference absorbance, wrapping after nine — so every value in the
 * fixture is one a researcher would recognise off the sheet rather than one invented here.
 * A1 is 0.132, the first of them; H12 is 0.262, the third, because twelve wraps to index two.
 * Every row is identical, which these scenarios do not mind: what they are about is which
 * shapes are accepted and which are refused, not what a curve through them looks like.
 */
function gridText(rows: number, cols: number): string {
  const at = (c: number) => REFERENCE_ABSORBANCES[c % REFERENCE_ABSORBANCES.length] as number
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, (_c, c) => at(c).toFixed(3)).join(','),
  ).join('\n')
}

/** The workbook's plate as a file would carry it: 8 by 12, rows E to H empty. */
const workbookFile = () => referencePlateText().split('\t').join(',')

const METADATA = 'Software Version,3.5.1\nPlate,Read 1\nWavelength,562nm\n\n'

When('a file holding an 8 by 12 grid is imported', async () => {
  mountOnce()
  analysis.importFile(gridText(8, 12))
  await settle()
})

Given('a file holding an 8 by 12 grid imported', async () => {
  mountOnce()
  analysis.importFile(gridText(8, 12))
  await settle()
})

When('a file holding an 8 by 12 grid with rows {string} to {string} empty is imported', async (
  _w: unknown, from: string, to: string,
) => {
  // The workbook's own plate is exactly this: 24 readings in a full frame. If the shape check
  // ever counts readings instead of cells, this scenario is what catches it.
  expect([from, to], 'the workbook plate is empty from row E to row H').toEqual(['E', 'H'])
  mountOnce()
  analysis.importFile(workbookFile())
  await settle()
})

When('a file holding {int} lines of instrument metadata above an 8 by 12 grid is imported', async (
  _w: unknown, lines: number,
) => {
  expect(METADATA.split('\n').filter((l) => l.trim() !== '').length, 'metadata lines').toBe(lines)
  mountOnce()
  analysis.importFile(METADATA + gridText(8, 12))
  await settle()
})

When('a file holding two 8 by 12 grids is imported', async () => {
  mountOnce()
  analysis.importFile(`${gridText(8, 12)}\n\n${gridText(8, 12)}`)
  await settle()
})

When('a file holding a {int} by {int} grid is imported', async (
  _w: unknown, rows: number, cols: number,
) => {
  mountOnce()
  analysis.importFile(gridText(rows, cols))
  await settle()
})

When('a file holding no numbers at all is imported', async () => {
  mountOnce()
  analysis.importFile('Software Version,3.5.1\nPlate,Read 1\nOperator,LK')
  await settle()
})

Given('the workbook\'s plate loaded with wells {string} assigned to {string}', async (
  _w: unknown, region: string, name: string,
) => {
  analysis.reset()
  analysis.sampleNames.value = ['MCF7', 'RPMI8226']
  analysis.pasteGrid(referencePlateText())
  analysis.painting.value = { kind: 'sample', name }
  analysis.paintWells(region.split(':').length === 2 ? expand(region) : [region])
  analysis.painting.value = { kind: 'off' }
  mountOnce()
  await settle()
})

/** "C1:C3" as its wells. Kept local so this file does not depend on the layout parser. */
function expand(region: string): string[] {
  const [from, to] = region.split(':') as [string, string]
  const row = from.slice(0, 1)
  const first = Number(from.slice(1))
  const last = Number(to.slice(1))
  return Array.from({ length: last - first + 1 }, (_, i) => `${row}${first + i}`)
}

When('the import is undone', async () => {
  one('undo-import').click()
  await settle()
})

Then('the import is refused', () => {
  const refusal = document.querySelector('[data-testid="import-refusal"]')
  expect(refusal, 'the page did not refuse the file').not.toBeNull()
  expect(document.querySelector('[data-testid="import-report"]'), 'it reported a read too')
    .toBeNull()
})

Then('the import is not refused', () => {
  const refusal = document.querySelector('[data-testid="import-refusal"]')
  const said = refusal?.textContent ?? ''
  expect(refusal, `the page refused the file: ${said}`).toBeNull()
})

Then('the refusal states that the file holds {int} grids', (_w: unknown, n: number) => {
  expect(one('import-refusal').textContent).toContain(`${n} grids`)
})

Then('the refusal states that the grid is {int} by {int}', (
  _w: unknown, rows: number, cols: number,
) => {
  expect(one('import-refusal').textContent).toContain(`${rows} by ${cols}`)
})

Then('the refusal states that no grid was found', () => {
  expect(one('import-refusal').textContent).toContain('no grid')
})

Then('the import reports that it skipped {int} lines above the grid', (
  _w: unknown, n: number,
) => {
  expect(one('import-report').textContent).toContain(`Skipped ${n} lines`)
})

Then('the import reports the lines the grid was read from', () => {
  // The metadata is 3 non-blank lines and a blank one, so the grid starts at line 5.
  expect(one('import-report').textContent).toContain('lines 5 to 12')
})

Then('the import reports that it read one grid', () => {
  expect(one('import-report').textContent).toContain('one grid')
})
