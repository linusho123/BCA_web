/**
 * Column definitions for the four tables this app shows.
 *
 * Kept apart from the pages because a cell formatter is a pure function of one row, and
 * separating them is what lets the formatting be unit tested without rendering a page. They
 * are data, not components.
 *
 * Every number goes through `src/domain/format`, so a value read off the screen and the same
 * value in an export were rounded by the same code.
 */

import type { CurveFit, StandardLevel } from '~/domain/curve'
import { fixed, grouped, percent, ratio } from '~/domain/format'
import type { LoadingRow, SampleResult } from '~/domain/samples'
import type { VialPlan } from '~/domain/dilution'
import type { Column } from './Table'

/** An absent number reads as a dash, never as "0" and never as an empty cell. */
const absent = <span class="text-slate-400">—</span>

const maybe = (value: number | null, digits: number) =>
  value === null || !Number.isFinite(value) ? absent : fixed(value, digits)

const codes = (issues: { code: string }[]) =>
  issues.length === 0 ? '' : issues.map((i) => i.code).join(', ')

/** The standards, as the curve saw them: one row per level. */
export function standardColumns(fit: CurveFit): ReadonlyArray<Column<StandardLevel>> {
  const index = new Map(fit.levels.map((l, i) => [l, i]))
  const at = (level: StandardLevel) => index.get(level) ?? -1

  return [
    { key: 'tube', header: 'Tube', cell: (l) => l.tubeId ?? absent },
    {
      key: 'conc',
      header: 'Concentration',
      note: 'µg/mL',
      align: 'right',
      cell: (l) => grouped(l.concUgPerML),
    },
    {
      key: 'abs',
      header: 'Mean absorbance',
      align: 'right',
      cell: (l) => maybe(fit.levelMeans[at(l)] ?? null, 4),
    },
    {
      key: 'recovery',
      header: 'Recovery',
      note: 'back-calculated ÷ nominal',
      align: 'right',
      cell: (l) => {
        const value = fit.recoveries[at(l)] ?? null
        return value === null ? absent : percent(value)
      },
    },
  ]
}

export const sampleColumns: ReadonlyArray<Column<SampleResult>> = [
  { key: 'name', header: 'Sample', cell: (r) => r.name },
  { key: 'n', header: 'n', align: 'right', cell: (r) => r.n },
  { key: 'abs', header: 'Mean absorbance', align: 'right', cell: (r) => maybe(r.meanAbs, 4) },
  { key: 'cv', header: 'CV', align: 'right', cell: (r) => (r.cvPercent === null ? absent : percent(r.cvPercent)) },
  {
    key: 'conc',
    header: 'Concentration',
    note: 'µg/mL, in the well',
    align: 'right',
    cell: (r) => (r.concUgPerML === null ? absent : grouped(r.concUgPerML, 2)),
  },
  {
    key: 'concUL',
    header: 'Concentration',
    note: 'µg/µL, at the dilution factor',
    align: 'right',
    cell: (r) => maybe(r.concUgPerUL, 4),
  },
  {
    key: 'flags',
    header: 'Flags',
    cell: (r) => (
      <span class="font-mono text-xs text-amber-700">
        {r.extrapolated ? 'EXTRAPOLATED ' : ''}
        {codes([...r.issues])}
      </span>
    ),
  },
]

export const loadingColumns: ReadonlyArray<Column<LoadingRow>> = [
  { key: 'name', header: 'Sample', cell: (r) => r.name },
  { key: 'protein', header: 'Protein', note: 'µL', align: 'right', cell: (r) => maybe(r.proteinUL, 2) },
  { key: 'diluent', header: 'Diluent', note: 'µL', align: 'right', cell: (r) => maybe(r.diluentUL, 2) },
  { key: 'dye', header: 'Dye', note: 'µL', align: 'right', cell: (r) => fixed(r.dyeUL, 2) },
  { key: 'total', header: 'Final volume', note: 'µL', align: 'right', cell: (r) => fixed(r.finalVolumeUL, 2) },
  {
    key: 'feasible',
    header: 'Loadable',
    cell: (r) =>
      r.feasible ? (
        <span class="text-emerald-700">yes</span>
      ) : (
        <span class="text-red-700" title={codes([...r.issues])}>
          no
        </span>
      ),
  },
]

export const vialColumns: ReadonlyArray<Column<VialPlan>> = [
  { key: 'vial', header: 'Vial', cell: (v) => v.vialId },
  { key: 'conc', header: 'Final', note: 'µg/mL', align: 'right', cell: (v) => grouped(v.finalConcUgPerML) },
  { key: 'source', header: 'Source', cell: (v) => v.source ?? absent },
  {
    key: 'df',
    header: 'Dilution',
    align: 'right',
    cell: (v) => (v.dilutionFactor === null ? absent : ratio(v.dilutionFactor)),
  },
  { key: 'from', header: 'From source', note: 'µL', align: 'right', cell: (v) => fixed(v.volumeFromSourceUL, 2) },
  { key: 'diluent', header: 'Diluent', note: 'µL', align: 'right', cell: (v) => fixed(v.volumeDiluentUL, 2) },
  { key: 'total', header: 'Total', note: 'µL', align: 'right', cell: (v) => fixed(v.totalVolumeUL, 2) },
]
