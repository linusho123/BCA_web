/**
 * Reading a plate out of a file the instrument wrote.
 *
 * Proves features/analysis/plate-grid-from-file.feature.
 *
 * Two surfaces, and the second is the one that matters. An import that lands says what it read
 * and what it stepped over, because an automatic import nobody can check is a guess with better
 * manners — the researcher has to be able to see that the grid came from the lines they expected.
 * An import that is refused says what is wrong with the file in the file's own terms, and
 * changes nothing.
 *
 * The file is validated through `UploadSchema` before it is read: it arrives from a drop event,
 * a file input or a test, and only one of those three produces a real `File`.
 */

import { MAX_UPLOAD_BYTES, readUpload } from '~/schemas/upload'
import { decodePlateBytes } from '~/domain/plate'
import * as analysis from '~/state/analysis'

/**
 * Read a chosen file and hand its text to the import.
 *
 * `readUpload` does the validating and the reading rather than this component doing its own.
 * The component used to parse with `UploadSchema` and then call `arrayBuffer` on the *parsed*
 * object, which is the schema's plain-object copy of the method with the file left behind: it
 * threw on every real file, and because the caller only voided the promise, the page showed
 * neither a grid nor a refusal. Two surfaces that both stayed silent.
 *
 * The catch is the other half of that lesson. Anything unexpected in here has to end as a
 * refusal on screen, because the one outcome this feature may never have is nothing happening.
 */
async function readAndImport(file: unknown): Promise<void> {
  try {
    const { bytes, issues } = await readUpload(file)
    if (bytes === null) {
      analysis.rejectImport(issues[0]?.message ?? 'that file could not be read')
      return
    }
    analysis.importFile(decodePlateBytes(bytes).text)
  } catch {
    analysis.rejectImport('that file could not be read')
  }
}

export function PlateImport() {
  const outcome = analysis.lastImport.value

  return (
    <div class="space-y-2">
      <label class="inline-flex items-center gap-2 text-sm">
        <span class="font-medium text-slate-700">Import a reader file</span>
        <input
          type="file"
          accept=".csv,.txt,.tsv,text/csv,text/plain"
          data-testid="import-file"
          class="text-xs file:mr-2 file:rounded-md file:border file:border-slate-300
                 file:bg-white file:px-2 file:py-1 file:text-xs hover:file:bg-slate-50"
          onChange={(e) => {
            const input = e.target as HTMLInputElement
            const file = input.files?.[0]
            if (file) void readAndImport(file)
            // Cleared so that choosing the same file twice fires a second change event; without
            // this, re-importing after an undo silently does nothing.
            input.value = ''
          }}
        />
      </label>

      {outcome.kind === 'read' && (
        <div
          data-testid="import-report"
          class="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        >
          <p>
            Read one grid from lines {outcome.found.firstLine} to {outcome.found.lastLine}.
            {outcome.found.skippedAbove > 0 && (
              <> Skipped {outcome.found.skippedAbove} lines of instrument metadata above it.</>
            )}
          </p>
          {analysis.canUndoImport.value && (
            <button
              type="button"
              data-testid="undo-import"
              class="mt-1 rounded-md border border-emerald-400 px-2 py-1 text-xs hover:bg-emerald-100"
              onClick={() => analysis.undoImport()}
            >
              Undo this import
            </button>
          )}
        </div>
      )}

      {outcome.kind === 'refused' && (
        <p
          data-testid="import-refusal"
          role="alert"
          class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          This file was not imported: {outcome.refusal.message}.
        </p>
      )}

      <p class="text-xs text-slate-500">
        A CSV or tab-separated export, up to {Math.round(MAX_UPLOAD_BYTES / 1024)} KB. The grid is
        found inside the file, so instrument headers above it are fine.
      </p>
    </div>
  )
}
