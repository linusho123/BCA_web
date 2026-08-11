/**
 * The dilution planner: a standard series, and how to pipette it.
 *
 * The plan is shown in the order the domain returned it, which is the order the vials have to
 * be made in — every source before the vials drawing from it. Sorting the table by anything
 * else would be showing a pipetting scheme that cannot be followed top to bottom.
 */

import { DILUTION_PRESETS, type DilutionPresetId } from '~/domain/constants'
import { allDilutionIssues } from '~/domain/dilution'
import { Stage } from '~/domain/errors'
import { dilutionPlanToCsv } from '~/domain/export'
import { grouped } from '~/domain/format'
import {
  dilution,
  dilutionReplicates,
  overageFactor,
  preset,
  stockConcUgPerUL,
  volumePerWellUL,
} from '~/state/planning'
import { staged } from '~/state/stage'
import { IssuePanel } from './IssuePanel'
import { Table } from './Table'
import { vialColumns } from './columns'
import { download } from './download'
import { NumberField } from './fields'

const PRESET_IDS = Object.keys(DILUTION_PRESETS) as DilutionPresetId[]

export function DilutionPage() {
  const plan = dilution.value

  return (
    <div class="mx-auto max-w-5xl space-y-8 p-6">
      <header>
        <h1 class="text-xl font-semibold text-slate-900">Standard dilution series</h1>
        <p class="mt-1 text-sm text-slate-600">
          How much stock and how much diluent go into each vial, in the order they must be made.
        </p>
      </header>

      <section aria-labelledby="series-heading" class="space-y-4">
        <h2 id="series-heading" class="text-base font-semibold text-slate-900">
          Series
        </h2>

        <label class="block text-sm">
          <span class="font-medium text-slate-700">Preset</span>
          <select
            data-testid="preset"
            class="mt-1 block w-72 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={preset.value}
            onChange={(e) =>
              (preset.value = (e.target as HTMLSelectElement).value as DilutionPresetId)
            }
          >
            {PRESET_IDS.map((id) => (
              <option key={id} value={id}>
                {DILUTION_PRESETS[id].label}
              </option>
            ))}
          </select>
        </label>

        <div class="flex flex-wrap gap-4">
          <NumberField
            label="Stock"
            hint="µg/µL"
            value={stockConcUgPerUL.value}
            onChange={(v) => (stockConcUgPerUL.value = v)}
            step={0.1}
          />
          <NumberField
            label="Volume per well"
            hint="µL"
            value={volumePerWellUL.value}
            onChange={(v) => (volumePerWellUL.value = v)}
          />
          <NumberField
            label="Replicates"
            value={dilutionReplicates.value}
            onChange={(v) => (dilutionReplicates.value = v)}
            step={1}
          />
          <NumberField
            label="Overage"
            hint="Extra volume to prepare, as a multiple."
            value={overageFactor.value}
            onChange={(v) => (overageFactor.value = v)}
            step={0.1}
          />
        </div>

        <p class="text-sm text-slate-600" data-testid="prepare-summary">
          {grouped(plan.volumeToPrepareUL, 1)} µL per vial before overage;{' '}
          {grouped(plan.totalWaterUL, 1)} µL of diluent in total.
        </p>

        <IssuePanel issues={staged(Stage.DILUTION, null, allDilutionIssues(plan)).issues} />

        <Table
          testId="dilution-table"
          caption="Pipetting scheme, in preparation order"
          columns={vialColumns}
          rows={[...plan.vials]}
          rowKey={(v) => v.vialId}
          empty="No vials in this series."
        />

        <button
          type="button"
          data-testid="export-dilution"
          class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          onClick={() => download('bca-dilution-plan.csv', dilutionPlanToCsv(plan))}
        >
          Export the plan
        </button>
      </section>
    </div>
  )
}
