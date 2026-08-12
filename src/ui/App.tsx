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
import { useEffect } from 'preact/hooks'
import { FlaskConical, type LucideIcon, LineChart, TestTubes } from 'lucide-preact'
import type { ComponentType } from 'preact'
import * as analysis from '~/state/analysis'
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

/**
 * Which page is on screen.
 *
 * Exported so a harness can put a page up without clicking a tab and waiting for a render. The
 * app itself only ever sets it from the hash or from a tab click.
 */
export const currentPage = signal(fromHash())

browser.addEventListener?.('hashchange', () => {
  currentPage.value = fromHash()
})

export function App() {
  // The session is written here, in the shell, rather than on the page that hosts each control.
  //
  // It used to be written only by the analysis page, and the settings it named were the ones
  // that page owns — so the promise session-continuity.feature makes for "the settings" was
  // kept for all of them except the procedure, which is chosen on the protocol page. That one
  // reached storage late, off the back of the analysis page mounting, and a second choice never
  // reached it at all: the screen showed the new procedure, the store held the old one, and a
  // reload silently restored what nobody chose. It is not a cosmetic difference — the procedure
  // decides the working range every sample is flagged against.
  //
  // A second effect on the protocol page would have fixed the procedure and left the same hole
  // open for the next setting added to a page that has no effect of its own. The shell is the
  // one component mounted for every page, so the rule "a setting is written when it changes"
  // can be true here in a way it cannot be anywhere else.
  //
  // The deps are the settings themselves, not the pages, so nothing else re-triggers a write:
  // the reagent calculator's own inputs live in state/planning.ts and are not persisted.
  useEffect(() => analysis.persist(), [
    analysis.plateText.value,
    analysis.sampleNames.value,
    analysis.standardRegions.value,
    analysis.sampleAssignments.value,
    analysis.blankSubtract.value,
    analysis.fitModel.value,
    analysis.dilutionFactor.value,
    analysis.standardsDirection.value,
    analysis.procedure.value,
  ])

  const page = PAGES.find((p) => p.id === currentPage.value) ?? PAGES[2]
  if (page === undefined) return null
  const { Component } = page

  return (
    <div class="min-h-screen bg-white text-slate-900">
      <nav aria-label="Sections" class="border-b border-slate-200">
        <ul class="mx-auto flex max-w-6xl gap-1 px-6">
          {PAGES.map(({ id, label, Icon }) => {
            const active = id === currentPage.value
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
                    currentPage.value = id
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
