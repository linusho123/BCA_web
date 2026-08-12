/**
 * Shared machinery for the two feature files that run in a browser.
 *
 * Everything else in features/steps/ addresses the domain and renders nothing. These two do not,
 * because what they claim cannot be checked anywhere else: that focus reaches what hover reaches,
 * that a failed stage leaves its neighbours drawn, that no request goes out. Each of those is a
 * property of a rendered page.
 *
 * The reactive state is module-level — the app has one analysis, not one per component — so a
 * scenario has to put it back the way it found it or the next scenario inherits a plate. The
 * `Before` hook here does that, once, for every scenario in both files.
 *
 * `.tsx` rather than `.ts` because mounting the page is JSX, and the page is what these features
 * are about.
 */

import { After, Before } from 'quickpickle'
import { cleanup, render } from 'vitest-browser-preact'
import { REFERENCE_ABSORBANCES } from '~/domain/reference'
import * as analysis from '~/state/analysis'
import { AnalysisPage } from '~/ui/AnalysisPage'
import type { World } from '../../support/world'

/** The names the workflow feature uses throughout. */
export const SAMPLE_NAMES = ['MCF7', 'RPMI8226'] as const

/** How wide a pasted plate is. Un-plated wells carry the reader's own dash, not nothing. */
const PLATE_COLUMNS = 12
const PLATE_ROWS = 8
const EMPTY_WELL = '-'

/**
 * Reset every input signal, unmount whatever the last scenario rendered, and start recording.
 *
 * The watchers go on here rather than in a step because both of the things they exist to prove
 * are absences: nothing was requested, no absorbance was stored. An absence has to be watched for
 * from before the first render, or the evidence is a render late.
 */
Before(async (world: World) => {
  cleanup()
  storage()?.clear()
  // The plate is held in sessionStorage, not localStorage, so clearing one does not clear the
  // other — and a scenario that inherited the previous scenario's plate would pass for the
  // wrong reason. See src/schemas/session.ts for why the two are kept apart.
  tabStore()?.clear()
  analysis.restore()
  analysis.plateText.value = ''

  world.network = watchNetwork()
  world.storage = watchStorage()
  await Promise.resolve()
})

/** Put the globals back, so a scenario cannot leave the next one running through a stub. */
After(async (world: World) => {
  ;(world.network as NetworkWatch | undefined)?.stop()
  ;(world.storage as StorageWatch | undefined)?.stop()
  restoreMatchMedia()
  cleanup()
  await Promise.resolve()
})

// --- rendering -------------------------------------------------------------

/**
 * Render the analysis page, replacing whatever was rendered before it.
 *
 * `cleanup` first rather than rendering a second copy beside the first: several scenarios render
 * in a Given and again in a When, and two live trees would leave every query returning the older
 * one's elements.
 */
export function mount(): void {
  cleanup()
  render(<AnalysisPage />)
}

/** Render only if nothing is on screen — for a When that follows a Given which already did. */
export function mountOnce(): void {
  if (document.querySelector('[data-testid="plate-input"]') === null) mount()
}

// --- DOM queries -----------------------------------------------------------

/**
 * Every element with a given test id.
 *
 * Queried off `document` rather than off a render result, because several scenarios render once
 * in a Given and assert in a Then that runs after another step re-rendered — a captured container
 * would still be looking at the previous tree.
 */
export function all(testId: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)]
}

export function one(testId: string): HTMLElement {
  const [found] = all(testId)
  if (!found) throw new Error(`no element with data-testid="${testId}" is rendered`)
  return found
}

export function exists(testId: string): boolean {
  return all(testId).length > 0
}

/** The text of an element, whitespace-collapsed the way a reader sees it. */
export function textOf(el: Element): string {
  return el.textContent.replace(/\s+/g, ' ').trim()
}

/** The first column of a rendered table, which is the label column in all of them. */
export function rowLabels(testId: string): string[] {
  return [...one(testId).querySelectorAll('tbody tr')]
    .map((row) => textOf(row.querySelector('td') ?? row))
    .filter((label) => label !== '')
}

/**
 * Wait for the DOM to catch up with a signal change.
 *
 * Preact batches renders into a microtask, so a step that assigns a signal and the step after it
 * that reads the DOM are separated by less than a frame. Two animation frames covers the render
 * and the ECharts layout the mark positions are read from.
 */
export function settle(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

// --- reading the analysis --------------------------------------------------

/**
 * The concentrations currently reported, in table order.
 *
 * Read off the signal rather than out of the rendered cell, because a cell is rounded to two
 * decimals and a scenario asserting that a concentration *changed* would pass on two different
 * numbers that round the same way.
 */
export function reportedConcentrations(): Array<number | null> {
  return analysis.samples.value.value.map((r) => r.concUgPerML)
}

/** What each sample's stock is reported to hold, which is the well reading with its dilution undone. */
export function reportedStocks(): Array<number | null> {
  return analysis.samples.value.value.map((r) => r.concUgPerUL)
}

/** The fitted coefficients, or null when nothing fitted. */
export function coefficients(): number[] | null {
  const fit = analysis.curve.value.value
  return fit.fitted ? [...fit.coefficients] : null
}

/** The focusable marks drawn over the canvas, in plot order. */
export function marks(): HTMLElement[] {
  return all('plot-point')
}

/** The mark for one point, by the label the plot gave it. */
export function markLabelled(label: string): HTMLElement {
  const found = marks().find((m) => m.getAttribute('data-label') === label)
  if (!found) {
    const drawn = marks().map((m) => m.getAttribute('data-label')).join(', ') || 'none'
    throw new Error(`no plotted mark is labelled "${label}"; the chart drew: ${drawn}`)
  }
  return found
}

// --- building plates -------------------------------------------------------

/** One pasted row, padded to the full plate width with the reader's empty-well token. */
export function plateRow(values: readonly (number | string)[]): string {
  return [
    ...values.map(String),
    ...Array<string>(Math.max(0, PLATE_COLUMNS - values.length)).fill(EMPTY_WELL),
  ].join('\t')
}

/** Rows padded out to a full plate, so the grid is rectangular and not reported as ragged. */
export function plateOf(rows: readonly string[]): string {
  const padded = [...rows]
  while (padded.length < PLATE_ROWS) padded.push(plateRow([]))
  return padded.join('\n')
}

/**
 * The workbook's standards in rows A and B, with one row per unknown below them.
 *
 * Three replicates each, which is how this assay is plated and what makes the default layout
 * produce a C1:C3-shaped region without being told to.
 */
export function plateWithSamples(absorbances: readonly number[]): string {
  const standards = plateRow(REFERENCE_ABSORBANCES)
  return plateOf([standards, standards, ...absorbances.map((a) => plateRow([a, a, a]))])
}

/** Names for `n` unknowns, so a scenario that only cares about the count need not invent them. */
export function sampleNamesFor(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `S${i + 1}`)
}

// --- stubbing what the browser reports -------------------------------------

let originalMatchMedia: typeof globalThis.matchMedia | undefined
let matchMediaStubbed = false

/**
 * Answer `prefers-reduced-motion` the way the scenario says the reader has it set.
 *
 * Stubbed rather than driven through the real browser setting, because the setting belongs to the
 * machine running the suite, and a scenario that only passes on a laptop configured a particular
 * way is one nobody else can run.
 */
export function stubReducedMotion(prefers: boolean): void {
  const target = globalThis as { matchMedia?: typeof globalThis.matchMedia }
  if (!matchMediaStubbed) {
    originalMatchMedia = target.matchMedia
    matchMediaStubbed = true
  }
  target.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? prefers : false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

function restoreMatchMedia(): void {
  if (!matchMediaStubbed) return
  const target = globalThis as { matchMedia?: typeof globalThis.matchMedia }
  if (originalMatchMedia === undefined) delete target.matchMedia
  else target.matchMedia = originalMatchMedia
  matchMediaStubbed = false
  originalMatchMedia = undefined
}

// --- watching for the things that must not happen --------------------------

/**
 * A recording of every way this app could reach the network.
 *
 * Each entry records and then delegates to the real thing rather than replacing it. A stub that
 * rejected would make "no request was made" pass for a page that tried and failed, which is a
 * different fact — and the test runner itself talks to its server through these globals, so
 * breaking them breaks the run rather than the assertion.
 */
export interface NetworkWatch {
  readonly calls: string[]
  stop: () => void
}

export function watchNetwork(): NetworkWatch {
  const calls: string[] = []
  const target = globalThis as unknown as Record<string, unknown>

  const originalFetch = globalThis.fetch.bind(globalThis)
  const originalSocket = globalThis.WebSocket

  // Taken as a descriptor rather than read off the prototype, because a prototype method pulled
  // out by name arrives without its receiver, and putting it back has to restore the property the
  // way it was defined rather than a copy of it.
  const openSlot = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'open')
  const openThrough = openSlot?.value as
    | ((this: XMLHttpRequest, ...args: unknown[]) => void)
    | undefined

  // `sendBeacon` is typed as always present and is not: it is absent in some browsers and under
  // some privacy settings. Typed honestly here so the guard below is not read as dead code.
  const beaconHost = navigator as { sendBeacon?: Navigator['sendBeacon'] }
  const originalBeacon = beaconHost.sendBeacon?.bind(navigator)

  target['fetch'] = (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`fetch ${requestUrl(input)}`)
    return originalFetch(input, init)
  }

  if (openThrough) {
    XMLHttpRequest.prototype.open = function open(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      calls.push(`xhr ${String(url)}`)
      openThrough.call(this, method, url, ...rest)
    }
  }

  target['WebSocket'] = class WatchedSocket extends originalSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      calls.push(`ws ${String(url)}`)
      super(url, protocols)
    }
  }

  if (originalBeacon) {
    beaconHost.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      calls.push(`beacon ${String(url)}`)
      return originalBeacon(url, data)
    }
  }

  return {
    calls,
    stop() {
      target['fetch'] = originalFetch
      if (openSlot) Object.defineProperty(XMLHttpRequest.prototype, 'open', openSlot)
      target['WebSocket'] = originalSocket
      if (originalBeacon) beaconHost.sendBeacon = originalBeacon
    },
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/**
 * The requests that belong to the page, with the harness's own traffic dropped.
 *
 * The suite runs inside a dev server that fetches modules, source maps and its own RPC over the
 * same globals the app would use. That is the test rig talking to itself; counting it would make
 * the assertion impossible to pass and would say nothing about the app either way.
 */
const HARNESS_PATHS = ['/__vitest', '/@vite', '/@id', '/@fs', '/node_modules', '/.vite', '.map']

export function appRequests(calls: readonly string[]): string[] {
  return calls.filter((call) => !HARNESS_PATHS.some((path) => call.includes(path)))
}

/**
 * Everything written to local storage during a scenario, as it was written.
 *
 * The workflow feature asserts that no assay value reaches storage. Reading the key afterwards
 * would only prove the last write was clean; recording every write proves none of them carried an
 * absorbance, including one that was later overwritten.
 */
export interface StorageWatch {
  readonly writes: Array<readonly [string, string]>
  stop: () => void
}

function storage(): Storage | undefined {
  return (globalThis as { localStorage?: Storage }).localStorage
}

/** Where the plate is held for the tab. Cleared between scenarios by the `Before` hook. */
export function tabStore(): Storage | undefined {
  return (globalThis as { sessionStorage?: Storage }).sessionStorage
}

export function watchStorage(): StorageWatch {
  const writes: Array<readonly [string, string]> = []
  const store = storage()
  if (!store) return { writes, stop: () => undefined }

  const original = store.setItem.bind(store)
  store.setItem = (key: string, value: string) => {
    writes.push([key, value] as const)
    original(key, value)
  }

  return {
    writes,
    stop() {
      store.setItem = original
    },
  }
}
