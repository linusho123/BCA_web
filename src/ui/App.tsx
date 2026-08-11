/**
 * The app shell: three pages and the tabs between them.
 *
 * Routed by a signal rather than by a router, because there are three destinations and no
 * parameters, and a hash is enough to survive a reload — which the workflow feature requires
 * of the session but not of the page you were on. Adding a router would be adding a dependency
 * to hold one string.
 *
 * The tabs are real links so they can be opened, copied and read as links; the click handler
 * only stops the navigation the browser would do anyway.
 */

import { signal } from '@preact/signals'
import { FlaskConical, type LucideIcon, LineChart, TestTubes } from 'lucide-preact'
import type { ComponentType } from 'preact'
import { AnalysisPage } from './AnalysisPage'
import { DilutionPage } from './DilutionPage'
import { ProtocolPage } from './ProtocolPage'

interface Page {
  readonly id: string
  readonly label: string
  readonly Icon: LucideIcon
  readonly Component: ComponentType
}

const PAGES: readonly Page[] = [
  { id: 'protocol', label: 'Protocol', Icon: FlaskConical, Component: ProtocolPage },
  { id: 'dilutions', label: 'Dilutions', Icon: TestTubes, Component: DilutionPage },
  { id: 'analysis', label: 'Analysis', Icon: LineChart, Component: AnalysisPage },
]

const DEFAULT_PAGE = 'analysis'

/**
 * The browser globals this shell needs, typed as the optionals they are.
 *
 * The DOM library declares `location` and `addEventListener` as always present. They are not:
 * this module is imported by tests running under node, and reading `.hash` off nothing there is
 * a crash rather than a fallback. Typing them honestly is also what keeps the guards below from
 * being reported as unreachable.
 */
const browser = globalThis as {
  location?: Location
  addEventListener?: typeof globalThis.addEventListener
}

function fromHash(): string {
  const id = browser.location?.hash.replace(/^#\/?/, '') ?? ''
  return PAGES.some((p) => p.id === id) ? id : DEFAULT_PAGE
}

const current = signal(fromHash())

browser.addEventListener?.('hashchange', () => {
  current.value = fromHash()
})

export function App() {
  const page = PAGES.find((p) => p.id === current.value) ?? PAGES[2]
  if (page === undefined) return null
  const { Component } = page

  return (
    <div class="min-h-screen bg-white text-slate-900">
      <nav aria-label="Sections" class="border-b border-slate-200">
        <ul class="mx-auto flex max-w-6xl gap-1 px-6">
          {PAGES.map(({ id, label, Icon }) => {
            const active = id === current.value
            return (
              <li key={id}>
                <a
                  href={`#/${id}`}
                  data-testid={`nav-${id}`}
                  aria-current={active ? 'page' : undefined}
                  class={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm ${
                    active
                      ? 'border-brand-500 font-medium text-brand-900'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                  onClick={(e) => {
                    e.preventDefault()
                    if (browser.location) browser.location.hash = `#/${id}`
                    current.value = id
                  }}
                >
                  <Icon size={15} aria-hidden={true} />
                  {label}
                </a>
              </li>
            )
          })}
        </ul>
      </nav>

      <main>
        <Component />
      </main>
    </div>
  )
}
