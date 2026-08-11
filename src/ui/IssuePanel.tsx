/**
 * Everything the stages had to say, grouped by severity and named by stage.
 *
 * Grouped rather than listed because the severities are read differently: an error means a
 * number below it is unusable, a warning means a number is worth a second look, and a note is
 * context. A flat list makes a reader do that sorting themselves, on every run.
 *
 * An empty panel renders nothing at all rather than "no issues" — a session that has not
 * started must not look like one that failed.
 */

import { AlertCircle, AlertTriangle, Info } from 'lucide-preact'
import { Severity } from '~/domain/errors'
import { atSeverity, type StagedIssue } from '~/state/stage'

const GROUPS = [
  {
    severity: Severity.ERROR,
    title: 'Errors',
    hint: 'The results below these are not usable until this is fixed.',
    Icon: AlertCircle,
    tone: 'border-red-300 bg-red-50 text-red-900',
  },
  {
    severity: Severity.WARN,
    title: 'Warnings',
    hint: 'The numbers were computed, but check these before using them.',
    Icon: AlertTriangle,
    tone: 'border-amber-300 bg-amber-50 text-amber-900',
  },
  {
    severity: Severity.INFO,
    title: 'Notes',
    hint: '',
    Icon: Info,
    tone: 'border-slate-300 bg-slate-50 text-slate-700',
  },
] as const

export function IssuePanel({ issues }: { issues: readonly StagedIssue[] }) {
  if (issues.length === 0) return null

  return (
    <section aria-labelledby="issues-heading" data-testid="issue-panel" class="space-y-3">
      <h2 id="issues-heading" class="text-sm font-semibold text-slate-900">
        Issues
      </h2>

      {GROUPS.map(({ severity, title, hint, Icon, tone }) => {
        const group = atSeverity(issues, severity)
        if (group.length === 0) return null

        return (
          <div
            key={severity}
            data-testid={`issue-group-${severity}`}
            data-severity={severity}
            class={`rounded-lg border p-3 ${tone}`}
          >
            <h3 class="flex items-center gap-2 text-sm font-semibold">
              <Icon size={16} aria-hidden="true" />
              {title} ({group.length})
            </h3>
            {hint && <p class="mt-0.5 text-xs opacity-80">{hint}</p>}

            <ul class="mt-2 space-y-1.5 text-sm">
              {group.map((i, index) => (
                <li key={`${i.stage}:${i.code}:${index}`} data-testid="issue" data-stage={i.stage}>
                  {/* The stage is a chip rather than a prefix in the sentence: a reader
                      scanning for "which part of this went wrong" is scanning the left edge. */}
                  <span class="mr-1.5 rounded bg-white/70 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide">
                    {i.stage}
                  </span>
                  {i.message}
                  {i.field !== null && (
                    <span class="ml-1 font-mono text-xs opacity-70">({i.field})</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
