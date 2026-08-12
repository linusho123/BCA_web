/**
 * The three form controls this app needs.
 *
 * Every one of them wraps its input in a real `<label>` rather than pairing them by id, because
 * an id has to be unique across a page that renders the same field in more than one panel, and
 * a mismatch is invisible until someone navigates by screen reader.
 *
 * A number field reports the number, not the keystroke: an intermediate value like "1." or ""
 * is left in the box and simply not published upward, so typing never rewrites what is being
 * typed and never pushes a NaN into the pipeline.
 */

import { useId, useState } from 'preact/hooks'

interface FieldShell {
  label: string
  hint?: string
}

function Hint({ hint, id }: { hint: string | undefined; id: string }) {
  if (hint === undefined || hint === '') return null
  return (
    <span id={id} class="mt-0.5 block text-xs text-slate-500">
      {hint}
    </span>
  )
}

export interface TextFieldProps extends FieldShell {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  testId?: string
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  testId,
}: TextFieldProps) {
  const hintId = useId()
  return (
    <label class="block text-sm">
      <span class="font-medium text-slate-700">{label}</span>
      <input
        type="text"
        data-testid={testId}
        class="mt-1 w-64 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        value={value}
        placeholder={placeholder}
        aria-describedby={hint === undefined || hint === '' ? undefined : hintId}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
      />
      <Hint hint={hint} id={hintId} />
    </label>
  )
}

export interface NumberFieldProps extends FieldShell {
  value: number
  onChange: (value: number) => void
  min?: number
  step?: number
  testId?: string
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  min = 0,
  step,
  testId,
}: NumberFieldProps) {
  const hintId = useId()

  // What is in the box while it is being edited. Held locally so a half-typed "1." survives the
  // keystroke; the signal above only ever sees a finished number.
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <label class="block text-sm">
      <span class="font-medium text-slate-700">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        data-testid={testId}
        class="mt-1 w-40 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm
               tabular-nums"
        value={draft ?? String(value)}
        min={min}
        step={step}
        aria-describedby={hint === undefined || hint === '' ? undefined : hintId}
        onInput={(e) => {
          const text = (e.target as HTMLInputElement).value
          setDraft(text)
          const parsed = Number(text)
          if (text.trim() !== '' && Number.isFinite(parsed)) onChange(parsed)
        }}
        // On the way out the box is reconciled with the value that was actually accepted, so an
        // abandoned "1." does not sit there looking like the setting.
        onBlur={() => setDraft(null)}
      />
      <Hint hint={hint} id={hintId} />
    </label>
  )
}

export interface ToggleProps extends FieldShell {
  checked: boolean
  onChange: (checked: boolean) => void
  testId?: string
}

export function Toggle({ label, hint, checked, onChange, testId }: ToggleProps) {
  const hintId = useId()
  return (
    <label class="block text-sm">
      <span class="flex items-center gap-2">
        <input
          type="checkbox"
          data-testid={testId}
          class="h-4 w-4 rounded border-slate-300"
          checked={checked}
          aria-describedby={hint === undefined || hint === '' ? undefined : hintId}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        />
        <span class="font-medium text-slate-700">{label}</span>
      </span>
      <Hint hint={hint} id={hintId} />
    </label>
  )
}

export interface SelectProps<T extends string> extends FieldShell {
  value: T
  options: ReadonlyArray<readonly [T, string]>
  onChange: (value: T) => void
  testId?: string
}

/**
 * One of a short, fixed set of choices.
 *
 * A native `select` rather than a styled listbox: it is reachable by keyboard, announced by a
 * screen reader, and on a phone it opens the platform picker. Three mutually exclusive options
 * is exactly what the element is for, and a hand-rolled replacement would have to re-earn all
 * of that to look slightly different.
 */
export function Select<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  testId,
}: SelectProps<T>) {
  const hintId = useId()
  return (
    <label class="block text-sm">
      <span class="font-medium text-slate-700">{label}</span>
      <select
        data-testid={testId}
        class="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm
               focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        value={value}
        aria-describedby={hint === undefined || hint === '' ? undefined : hintId}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}
      >
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
      <Hint hint={hint} id={hintId} />
    </label>
  )
}
