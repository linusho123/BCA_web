/**
 * The protocol page: pick a procedure, get the working reagent volumes for it.
 *
 * The procedure is picked here rather than on the analysis page because it decides the sample
 * volume, the reagent volume and the working range — everything the bench does before a plate
 * exists. It is the same signal the analysis reads, so choosing it once is choosing it everywhere.
 */

import { PROCEDURES, Procedure, REAGENT_A_PARTS, REAGENT_B_PARTS } from '~/domain/constants'
import { fixed, grouped } from '~/domain/format'
import { Stage } from '~/domain/errors'
import { procedure } from '~/state/analysis'
import {
  excessFactor,
  nReplicates,
  nStandards,
  nUnknowns,
  reagent,
} from '~/state/planning'
import { IssuePanel } from './IssuePanel'
import { NumberField } from './fields'
import { staged } from '~/state/stage'

const PROCEDURE_LIST = Object.values(Procedure)

export function ProtocolPage() {
  const spec = PROCEDURES[procedure.value]
  const wr = reagent.value
  const [rangeLow, rangeHigh] = spec.workingRangeUgPerML

  return (
    <div class="mx-auto max-w-4xl space-y-8 p-6">
      <header>
        <h1 class="text-xl font-semibold text-slate-900">Protocol and working reagent</h1>
        <p class="mt-1 text-sm text-slate-600">
          How much reagent to mix, and in what ratio, for the plate you are about to run.
        </p>
      </header>

      <section aria-labelledby="procedure-heading" class="space-y-3">
        <h2 id="procedure-heading" class="text-base font-semibold text-slate-900">
          Procedure
        </h2>

        <label class="block text-sm">
          <span class="font-medium text-slate-700">Assay format</span>
          <select
            data-testid="procedure"
            class="mt-1 block w-72 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={procedure.value}
            onChange={(e) => (procedure.value = (e.target as HTMLSelectElement).value as Procedure)}
          >
            {PROCEDURE_LIST.map((p) => (
              <option key={p} value={p}>
                {PROCEDURES[p].label}
              </option>
            ))}
          </select>
        </label>

        <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Fact term="Sample" value={`${fixed(spec.sampleVolumeUL, 0)} µL`} />
          <Fact term="Working reagent" value={`${fixed(spec.wrVolumeUL, 0)} µL`} />
          <Fact term="Ratio" value={spec.ratioLabel} />
          <Fact term="Incubation" value={spec.incubation} />
          <Fact
            term="Working range"
            value={`${grouped(rangeLow)}–${grouped(rangeHigh)} µg/mL`}
          />
        </dl>
      </section>

      <section aria-labelledby="reagent-heading" class="space-y-3">
        <h2 id="reagent-heading" class="text-base font-semibold text-slate-900">
          Working reagent
        </h2>

        <div class="flex flex-wrap gap-4">
          <NumberField
            label="Standards"
            value={nStandards.value}
            onChange={(v) => (nStandards.value = v)}
            step={1}
          />
          <NumberField
            label="Unknowns"
            value={nUnknowns.value}
            onChange={(v) => (nUnknowns.value = v)}
            step={1}
          />
          <NumberField
            label="Replicates"
            value={nReplicates.value}
            onChange={(v) => (nReplicates.value = v)}
            step={1}
          />
          <NumberField
            label="Excess factor"
            value={excessFactor.value}
            onChange={(v) => (excessFactor.value = v)}
            step={0.1}
            hint="What is mixed above what the formula requires."
          />
        </div>

        <IssuePanel issues={staged(Stage.REAGENT, null, wr.issues).issues} />

        <dl
          data-testid="reagent-result"
          class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3"
        >
          <Fact term="Wells" value={String(wr.nWells)} />
          <Fact term="Per sample" value={`${fixed(wr.volumePerSampleUL, 0)} µL`} />
          {/* The formula's answer and what is actually mixed are shown side by side: an
              excess factor that quietly folded into one number is one nobody can audit. */}
          <Fact term="Formula total" value={`${grouped(wr.baseVolumeUL, 1)} µL`} />
          <Fact term="To prepare" value={`${fixed(wr.totalVolumeML, 2)} mL`} />
          <Fact
            term={`Reagent A (${REAGENT_A_PARTS} parts)`}
            value={`${grouped(wr.reagentAUL, 1)} µL`}
          />
          <Fact
            term={`Reagent B (${REAGENT_B_PARTS} part)`}
            value={`${grouped(wr.reagentBUL, 1)} µL`}
          />
        </dl>
      </section>
    </div>
  )
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt class="text-xs uppercase tracking-wide text-slate-500">{term}</dt>
      <dd class="font-medium tabular-nums text-slate-900">{value}</dd>
    </div>
  )
}
