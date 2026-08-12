/**
 * The plate as 96 wells you can type into.
 *
 * Proves features/analysis/plate-grid.feature.
 *
 * Always 8 by 12, even before anything has been entered. The grid is a picture of the plate on
 * the bench, and that plate has 96 wells whether or not they are full — a grid that grew to fit
 * what had been typed so far would tell a researcher who has filled row C that their plate has
 * one row in it.
 *
 * Every cell is a real `input`, not a div with a click handler. That is what makes the grid
 * reachable by tab, operable by a screen reader, and typeable on a phone keyboard, and it is
 * the same reason the chart's marks are real buttons — see curve-plot-presentation.feature.
 *
 * Cells hold raw text, not numbers. `parsePlate` decides what is a measurement, once, over the
 * whole grid; a cell that judged its own contents would have to reject "0." halfway through
 * someone typing "0.132".
 */

import { useRef } from 'preact/hooks'
import { PLATE_COLUMNS, PLATE_ROWS } from '~/domain/constants'
import { wellValue } from '~/domain/plate'
import * as analysis from '~/state/analysis'

export function PlateGrid() {
  /**
   * Whether a painting drag is under way — a ref, not a signal, and not state.
   *
   * Nothing on the page renders differently while the button is down, so a signal here would
   * schedule 96 renders across a sweep to change something no one can see. It also has to be
   * readable synchronously by the handler of the very next event, and a re-render between two
   * pointer events is not something a drag can wait for.
   */
  const dragging = useRef(false)
  const grid = analysis.grid.value
  const data = analysis.plate.value.value
  const assigned = analysis.assignmentOf.value
  const armed = analysis.paintArmed.value

  const target = analysis.painting.value
  const entries: Array<{ id: string; label: string; t: analysis.PaintTarget }> = [
    { id: 'off', label: 'Type values', t: { kind: 'off' } },
    { id: 'standards', label: 'Standards', t: { kind: 'standards' } },
    ...analysis.sampleNames.value.map((name) => ({
      id: `sample-${name}`,
      label: name,
      t: { kind: 'sample' as const, name },
    })),
    { id: 'erase', label: 'Erase', t: { kind: 'erase' } },
  ]
  const isCurrent = (t: analysis.PaintTarget) =>
    t.kind === target.kind && (t.kind !== 'sample' || t.name === (target as { name?: string }).name)

  return (
    <div
      class="overflow-x-auto"
      // The ordinary end of a drag, caught here rather than on each well so that a release over
      // a gap between wells, over the column headers, or anywhere else inside the grid still
      // ends it. The pointerenter guard above is the backstop for releases outside it entirely.
      onPointerUp={() => {
        dragging.current = false
      }}
    >
      <div
        role="radiogroup"
        aria-label="What a click on a well means"
        data-testid="palette"
        class="mb-2 flex flex-wrap gap-1"
      >
        {entries.map((e) => (
          <button
            key={e.id}
            type="button"
            role="radio"
            aria-checked={isCurrent(e.t)}
            data-testid={`paint-${e.id}`}
            class={`rounded-md border px-2 py-1 text-xs ${
              isCurrent(e.t)
                ? 'border-sky-600 bg-sky-50 font-medium text-sky-900'
                : 'border-slate-300 hover:bg-slate-50'
            }`}
            onClick={() => (analysis.painting.value = e.t)}
          >
            {e.label}
          </button>
        ))}
      </div>
      <table
        data-testid="plate-grid"
        class="border-separate border-spacing-0.5 text-xs"
      >
        <caption class="sr-only">
          The plate, as 96 wells. Each cell holds the absorbance read at that well.
        </caption>
        <thead>
          <tr>
            <th class="w-6" />
            {PLATE_COLUMNS.map((col) => (
              <th key={col} scope="col" class="w-14 pb-1 font-medium text-slate-500">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PLATE_ROWS.map((row, r) => (
            <tr key={row}>
              <th scope="row" class="pr-1 text-right font-medium text-slate-500">
                {row}
              </th>
              {PLATE_COLUMNS.map((col, c) => {
                const well = `${row}${col}`
                const entry = grid[r]?.[c] ?? ''
                // Something was typed here, and the plate could make no measurement of it —
                // "OVRFLW", or a typo. The entry stays where it was typed; what changes is
                // that the well stops claiming to be a reading.
                const unreadable = entry !== '' && wellValue(data, row, col) === null
                const holds = assigned.get(well)
                return (
                  <td key={well} class="align-top">
                    <input
                      type="text"
                      inputMode="decimal"
                      data-testid={`well-${well}`}
                      aria-label={`Well ${well}`}
                      aria-invalid={unreadable}
                      data-unreadable={unreadable ? 'true' : undefined}
                      class={`w-14 rounded border px-1 py-0.5 text-right tabular-nums
                              focus:outline-none focus:ring-1 focus:ring-sky-500 ${
                                unreadable
                                  ? 'border-red-400 bg-red-50'
                                  : 'border-slate-300 focus:border-sky-500'
                              }`}
                      value={entry}
                      onInput={(e) =>
                        analysis.typeIntoWell(well, (e.target as HTMLInputElement).value)
                      }
                      onClick={() => {
                        if (armed) analysis.paintWells([well])
                      }}
                      onPointerDown={(e) => {
                        // Mouse, trackpad and pen only. A finger dragging across the plate is
                        // scrolling it — the grid is wider than a phone — and there is no hover
                        // between press and release to paint with. Tap still paints, through the
                        // click handler above, which fires for touch like any other pointer.
                        if (!armed || e.pointerType === 'touch') return
                        dragging.current = true
                        // The starting well is painted on the press rather than left to the
                        // click, because a drag has no click on it: press on C1, release on C3,
                        // and the click lands on their common ancestor. Painting twice when the
                        // gesture is a plain click costs nothing — paintWells is a move into a
                        // set, so the second one finds the well already there.
                        analysis.paintWells([well])
                      }}
                      onPointerEnter={(e) => {
                        // `buttons` rather than a release event, because the release that ends a
                        // drag is not always delivered: let go past the edge of the window and
                        // this handler is the first thing that hears anything at all. Reading the
                        // state the browser reports means a gesture cannot stay armed after the
                        // button is up, whether or not anyone told us it went up.
                        if (dragging.current && e.buttons === 0) dragging.current = false
                        if (!armed || !dragging.current) return
                        analysis.paintWells([well])
                      }}
                      onKeyDown={(e) => {
                        // Enter rather than space: space is a character in a number field, and a
                        // well that could not hold "1 000" pasted from a spreadsheet would be a
                        // keyboard affordance bought with a typing bug.
                        if (armed && e.key === 'Enter') {
                          e.preventDefault()
                          analysis.paintWells([well])
                        }
                      }}
                    />
                    {/*
                      The assignment in words under the well. curve-plot-presentation AC1 says
                      identity is never carried by colour alone, and this grid has a stronger
                      claim on that rule than the chart does: the chart enhances a table holding
                      the same numbers, while painting is the only way to assign a sample.
                    */}
                    <div
                      data-testid={`assignment-${well}`}
                      class={`h-3 text-center text-[10px] leading-3 ${
                        holds === undefined ? 'text-transparent' : 'text-slate-600'
                      }`}
                    >
                      {holds ?? ''}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
