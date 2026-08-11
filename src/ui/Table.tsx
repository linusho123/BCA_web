/**
 * The one table in this app.
 *
 * A real `<table>` with real `<th scope>`, because headless means no semantics come for free
 * and every table here is a table of numbers a reader may be navigating by row and column.
 *
 * Columns are data — `{ key, header, cell, align }` — so a cell formatter is a pure function
 * that can be unit tested without rendering anything.
 */

import type { ComponentChildren } from 'preact'

export interface Column<T> {
  readonly key: string
  readonly header: string
  readonly cell: (row: T) => ComponentChildren
  readonly align?: 'left' | 'right'
  /** A short explanation shown under the header, for a column whose name is not enough. */
  readonly note?: string
}

export interface TableProps<T> {
  caption: string
  columns: ReadonlyArray<Column<T>>
  rows: readonly T[]
  /** A stable identity per row, so a re-render does not reuse the wrong cells. */
  rowKey: (row: T, index: number) => string
  /** Shown in place of the body when there is nothing yet. */
  empty?: string
  testId?: string
}

export function Table<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty = 'Nothing to show yet.',
  testId,
}: TableProps<T>) {
  return (
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-sm" data-testid={testId}>
        {/* Visible, not sr-only: a table of numbers with no title is one a reader has to
            infer from the columns, and this app has four of them on one page. */}
        <caption class="mb-2 text-left text-sm font-semibold text-slate-900">{caption}</caption>

        <thead>
          <tr class="border-b border-slate-300">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                class={`px-2 py-1.5 font-medium text-slate-700 ${
                  c.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {c.header}
                {c.note && <span class="block text-xs font-normal text-slate-500">{c.note}</span>}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} class="px-2 py-4 text-slate-500">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={rowKey(row, index)} class="border-b border-slate-200 last:border-0">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    class={`px-2 py-1.5 ${
                      c.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                    }`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
