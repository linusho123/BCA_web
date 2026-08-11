/**
 * The analysis page: plate in, loading volumes out.
 *
 * Every panel reads a derived signal and nothing else. There is no recalculate button and no
 * effect that recomputes on change, because features/analysis/analysis-workflow.feature makes
 * the reactive claim in both directions — editing a well changes the curve and everything
 * after it, changing the loading target changes nothing before it — and a dependency graph is
 * the only way to get both without keeping them true by hand.
 *
 * Each panel renders whatever its stage produced, including nothing. A failed stage leaves its
 * own panel saying so and its neighbours drawn, which is the whole reason the domain returns
 * issues rather than throwing.
 */

import { useEffect } from 'preact/hooks'
import { Download } from 'lucide-preact'
import { modelLabel } from '~/domain/constants'
import { num } from '~/domain/format'
import { curveToCsv, loadingToCsv, samplesToCsv, sessionToJson } from '~/domain/export'
import { referencePlateText } from '~/domain/reference'
import * as analysis from '~/state/analysis'
import { CurveChart } from './chart/CurveChart'
import { IssuePanel } from './IssuePanel'
import { Table } from './Table'
import { loadingColumns, sampleColumns, standardColumns } from './columns'
import { download } from './download'
import { NumberField, TextField, Toggle } from './fields'

export function AnalysisPage() {
  // Persistence is a side effect of the settings changing, not something a save button does.
  // Reading the snapshot inside the effect subscribes it to every signal the snapshot touches.
  useEffect(() => analysis.persist(), [
    analysis.sampleNames.value,
    analysis.standardRegions.value,
    analysis.sampleAssignments.value,
    analysis.blankSubtract.value,
    analysis.fitModel.value,
    analysis.dilutionFactor.value,
    analysis.desiredProteinUg.value,
    analysis.finalVolumeUL.value,
    analysis.includeDye.value,
    analysis.dyeFraction.value,
  ])

  const fit = analysis.curve.value.value
  const samples = analysis.samples.value.value
  const loading = analysis.loading.value.value
  const started = analysis.started.value

  const provenance = {
    fit,
    dilutionFactor: analysis.dilutionFactor.value,
    extra: { blankSubtracted: fit.blankSubtracted ? 'yes' : 'no' },
  }

  return (
    <div class="mx-auto max-w-6xl space-y-8 p-6">
      <header>
        <h1 class="text-xl font-semibold text-slate-900">BCA analysis</h1>
        <p class="mt-1 text-sm text-slate-600">
          Everything below runs in this browser. No absorbance is sent anywhere, and none is
          written to disk — only the layout and these settings are remembered between visits.
        </p>
      </header>

      <PlatePanel />

      {!started ? (
        <section
          data-testid="empty-state"
          class="rounded-lg border border-dashed border-slate-300 p-8 text-center"
        >
          <p class="font-medium text-slate-900">A plate is needed to begin.</p>
          <p class="mt-1 text-sm text-slate-600">
            Paste the reader&rsquo;s absorbance grid above, then name the unknowns. The standards
            are read from rows A and B; each row from C down is one sample.
          </p>
        </section>
      ) : (
        <>
          <IssuePanel issues={analysis.issues.value} />

          {/*
            Each stage is its own panel, and each panel renders whatever its stage produced.
            A stage that failed leaves its own panel saying so with its neighbours drawn —
            which is the claim in AC2, and the reason nothing here is wrapped in a guard that
            hides the rest of the page.
          */}
          <section
            aria-labelledby="curve-heading"
            data-testid="curve-panel"
            class="space-y-4"
          >
            <h2 id="curve-heading" class="text-base font-semibold text-slate-900">
              Standard curve
            </h2>

            <div class="flex flex-wrap items-end gap-4">
              <Toggle
                label="Subtract the blank"
                checked={analysis.blankSubtract.value}
                onChange={(v) => (analysis.blankSubtract.value = v)}
                hint="Off reproduces the legacy workbook exactly."
              />
              <p class="text-sm text-slate-600" data-testid="fit-model">
                {modelLabel(analysis.fitModel.value)}
              </p>
            </div>

            <CoefficientReadout />
            <CurveChart plot={analysis.plot.value} />

            <Table
              testId="standards-table"
              caption="Standards"
              columns={standardColumns(fit)}
              rows={[...fit.levels]}
              rowKey={(l, i) => l.tubeId ?? `level-${i}`}
              empty="No standards have been mapped from the plate yet."
            />

            <ExportButton
              label="Export the curve"
              filename="bca-curve.csv"
              build={() => curveToCsv(fit)}
            />
          </section>

          <section
            aria-labelledby="samples-heading"
            data-testid="samples-panel"
            class="space-y-4"
          >
            <h2 id="samples-heading" class="text-base font-semibold text-slate-900">
              Samples
            </h2>

            <NumberField
              label="Dilution factor"
              value={analysis.dilutionFactor.value}
              onChange={(v) => (analysis.dilutionFactor.value = v)}
              hint="How much the sample was diluted before it went in the well."
            />

            <Table
              testId="samples-table"
              caption="Back-calculated concentrations"
              columns={sampleColumns}
              rows={[...samples]}
              rowKey={(r) => r.name}
              empty="No unknowns have been mapped from the plate yet."
            />

            <ExportButton
              label="Export the samples"
              filename="bca-samples.csv"
              build={() => samplesToCsv(samples, provenance)}
            />
          </section>

          <section
            aria-labelledby="loading-heading"
            data-testid="loading-panel"
            class="space-y-4"
          >
            <h2 id="loading-heading" class="text-base font-semibold text-slate-900">
              SDS-PAGE loading
            </h2>

            <div class="flex flex-wrap gap-4">
              <NumberField
                label="Protein per lane (µg)"
                value={analysis.desiredProteinUg.value}
                onChange={(v) => (analysis.desiredProteinUg.value = v)}
              />
              <NumberField
                label="Final volume (µL)"
                value={analysis.finalVolumeUL.value}
                onChange={(v) => (analysis.finalVolumeUL.value = v)}
              />
              <Toggle
                label="Include loading dye"
                checked={analysis.includeDye.value}
                onChange={(v) => (analysis.includeDye.value = v)}
              />
            </div>

            <Table
              testId="loading-table"
              caption="Loading volumes"
              columns={loadingColumns}
              rows={[...loading]}
              rowKey={(r) => r.name}
              empty="Loading volumes appear once the samples have concentrations."
            />

            <ExportButton
              label="Export the loading plan"
              filename="bca-loading.csv"
              build={() => loadingToCsv(loading, provenance)}
            />
            <ExportButton
              label="Export the whole session"
              filename="bca-session.json"
              mime="application/json"
              build={() =>
                sessionToJson({
                  fit,
                  samples,
                  loading,
                  dilutionFactor: analysis.dilutionFactor.value,
                })
              }
            />
          </section>
        </>
      )}
    </div>
  )
}

/** The pasted grid and the layout applied to it. */
function PlatePanel() {
  return (
    <section aria-labelledby="plate-heading" class="space-y-3">
      <h2 id="plate-heading" class="text-base font-semibold text-slate-900">
        Plate
      </h2>

      <label class="block text-sm">
        <span class="font-medium text-slate-700">Absorbance grid</span>
        <textarea
          data-testid="plate-input"
          class="mt-1 h-40 w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
          placeholder="Paste the reader's grid — tab or comma separated, one row per plate row."
          value={analysis.plateText.value}
          onInput={(e) => (analysis.plateText.value = (e.target as HTMLTextAreaElement).value)}
        />
      </label>

      <div class="flex flex-wrap items-end gap-3">
        <TextField
          label="Sample names"
          hint="Comma separated, in plate-row order from C down."
          value={analysis.sampleNames.value.join(', ')}
          onChange={(v) =>
            analysis.applyDefaultLayout(
              v.split(',').map((s) => s.trim()).filter((s) => s !== ''),
            )
          }
        />
        <button
          type="button"
          data-testid="load-example"
          class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          onClick={() => {
            analysis.plateText.value = referencePlateText()
            analysis.applyDefaultLayout(['MCF7', 'RPMI8226'])
          }}
        >
          Load the worked example
        </button>
        <button
          type="button"
          data-testid="reset"
          class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          onClick={() => analysis.reset()}
        >
          Start over
        </button>
      </div>
    </section>
  )
}

/** The fitted polynomial, written out. */
function CoefficientReadout() {
  const fit = analysis.curve.value.value
  if (!fit.fitted) {
    return (
      <p data-testid="coefficients" class="text-sm text-slate-600">
        No coefficients — the curve did not fit.
      </p>
    )
  }
  return (
    <p data-testid="coefficients" class="font-mono text-xs text-slate-700">
      {fit.coefficients.map((c, i) => `${i > 0 ? ', ' : ''}${num(c)}`).join('')}
      {fit.rSquared !== null && (
        <span class="ml-2 font-sans text-slate-500">r² = {num(fit.rSquared)}</span>
      )}
    </p>
  )
}

/**
 * A download button.
 *
 * The file is built here and handed to the browser as a blob — nothing is uploaded to produce
 * it, which is the same promise the rest of the page makes about the network.
 */
function ExportButton({
  label,
  filename,
  build,
  mime = 'text/csv',
}: {
  label: string
  filename: string
  build: () => string
  mime?: string
}) {
  return (
    <button
      type="button"
      data-testid={`export-${filename}`}
      class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5
             text-sm hover:bg-slate-50"
      onClick={() => download(filename, build(), mime)}
    >
      <Download size={15} aria-hidden="true" />
      {label}
    </button>
  )
}
