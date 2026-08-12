/**
 * The analysis page: plate in, concentrations out.
 *
 * Every panel reads a derived signal and nothing else. There is no recalculate button and no
 * effect that recomputes on change, because features/analysis/analysis-workflow.feature makes
 * the reactive claim in both directions — editing a well changes the curve and everything
 * after it, changing the dilution factor changes nothing before it — and a dependency graph is
 * the only way to get both without keeping them true by hand.
 *
 * Each panel renders whatever its stage produced, including nothing. A failed stage leaves its
 * own panel saying so and its neighbours drawn, which is the whole reason the domain returns
 * issues rather than throwing.
 */

import { useEffect } from 'preact/hooks'
import { batch, useSignal } from '@preact/signals'
import { Download } from 'lucide-preact'
import { FitModel, modelLabel } from '~/domain/constants'
import { num } from '~/domain/format'
import { curveToCsv, samplesToCsv, sessionToJson } from '~/domain/export'
import * as analysis from '~/state/analysis'
import { CurveChart } from './chart/CurveChart'
import { IssuePanel } from './IssuePanel'
import { PlateGrid } from './PlateGrid'
import { PlateImport } from './PlateImport'
import { Table } from './Table'
import { sampleColumns, standardColumns } from './columns'
import { download } from './download'
import { NumberField, Select, TextField, Toggle } from './fields'

/** The three models the curve can be fitted with, highest degree first — see domain/curve.ts. */
const FIT_MODELS = [
  FitModel.INVERSE_CUBIC,
  FitModel.INVERSE_QUADRATIC,
  FitModel.INVERSE_LINEAR,
] as const

export function AnalysisPage() {
  // Persistence is a side effect of the settings changing, not something a save button does.
  // Reading the snapshot inside the effect subscribes it to every signal the snapshot touches.
  useEffect(() => analysis.persist(), [
    // The plate is in here because it is held for the tab now — typing into a well has to
    // survive a reload, and nothing else in this list changes when a well is typed into.
    analysis.plateText.value,
    analysis.sampleNames.value,
    analysis.standardRegions.value,
    analysis.sampleAssignments.value,
    analysis.blankSubtract.value,
    analysis.fitModel.value,
    analysis.dilutionFactor.value,
  ])

  const fit = analysis.curve.value.value
  const samples = analysis.samples.value.value
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
              <Select
                label="Curve model"
                testId="fit-model"
                value={analysis.fitModel.value}
                options={FIT_MODELS.map((m) => [m, modelLabel(m)] as const)}
                onChange={(v) => (analysis.fitModel.value = v)}
                hint="Cubic matches the workbook. Lower degrees need fewer standards."
              />
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
              testId="dilution-factor"
              value={analysis.dilutionFactor.value}
              onChange={(v) => (analysis.dilutionFactor.value = v)}
              hint="Extra dilution you did to the sample yourself. 1 if none. The assay's own
                    25 µL in 200 µL is already in the curve — the standards went through it too."
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
            <ExportButton
              label="Export the whole session"
              filename="bca-session.json"
              mime="application/json"
              build={() =>
                sessionToJson({
                  fit,
                  samples,
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
          onInput={(e) => analysis.pasteGrid((e.target as HTMLTextAreaElement).value)}
        />
      </label>

      {/*
        The grid and the paste box are one input, not two. Pasting fills the wells; typing in a
        well edits the same plate. Whichever a person reaches for, the other shows the result.
      */}
      <PlateImport />

      <PlateGrid />

      <div class="flex flex-wrap items-end gap-3">
        <SampleNamesField />
        <button
          type="button"
          data-testid="load-example"
          class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          onClick={() => analysis.loadWorkedExample()}
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

/**
 * The sample names, as one comma-separated line.
 *
 * The box holds what was typed; the app publishes what that parses to. Those are not the same
 * string and the field cannot be driven from the parsed list — that is the whole bug this
 * component exists to fix. Rendering `names.join(', ')` meant the instant a comma was typed the
 * trailing empty name was filtered away and the box redrawn one character shorter, so the comma
 * vanished under the cursor and a second sample could never be named. The palette offers one
 * entry per name, so a field that could only hold one name made painting a second sample
 * unreachable — a whole feature closed off by a re-render.
 *
 * Held for exactly as long as the field is being edited, then dropped on blur so that "MCF7,,"
 * reconciles to the "MCF7" the app actually took. This is the same arrangement `NumberField`
 * uses for a half-typed "1.", for the same reason: a control that rewrites what is being typed
 * cannot be typed into.
 *
 * The draft is a signal rather than `useState`, and that is not a preference. `useState` and a
 * signal are two schedulers: the same keystroke calls `setDraft` and then `applyDefaultLayout`,
 * and the signal write re-renders synchronously while the hook update is still queued. That
 * render reads the previous draft and puts the published string back in the box — the original
 * bug, now intermittent rather than constant, which is worse. One signal means one render with
 * both facts already in it. A test that typed a comma caught this about one run in seven.
 *
 * `useSignal` rather than a module-level `signal`, because a module-level one would outlive the
 * component: an abandoned half-typed name would still be in the box for the next person to
 * mount the page, and in the suite it would leak from one scenario into the next.
 */
function SampleNamesField() {
  const nameDraft = useSignal<string | null>(null)
  const draft = nameDraft.value
  const published = analysis.sampleNames.value.join(', ')

  return (
    <TextField
      label="Sample names"
      testId="sample-names"
      hint="Comma separated, in plate-row order from C down."
      value={draft ?? published}
      onChange={(v) => {
        batch(() => {
          nameDraft.value = v
          analysis.applyDefaultLayout(
            v.split(',').map((s) => s.trim()).filter((s) => s !== ''),
          )
        })
      }}
      onBlur={() => (nameDraft.value = null)}
    />
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
