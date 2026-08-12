# BCA_web

Pierce BCA protein assay: plan the dilution series, fit the standard curve, back-calculate the
unknowns, and get SDS-PAGE loading volumes. A port of `BCA_quarto` from Quarto + Shinylive to a
Preact app.

**Every calculation runs in the browser.** No absorbance leaves the machine it was pasted into.
There is no server, no request, and no analytics — and that is not a claim in a README, it is a
scenario: `analysis-workflow.feature` installs watches on `fetch`, `XMLHttpRequest`, `WebSocket`
and `sendBeacon` and fails if the page touches any of them. It also checks that nothing written
to `localStorage` carries an absorbance or a concentration. What persists is the layout and the
settings; the plate is deliberately not among them.

## Running it

```sh
npm install
npm run dev       # http://localhost:5173
npm run verify    # the gate: features lint, eslint, tsc, and every test
```

Node `>=22.12.0`.

## The three pages

**Protocol** — pick a procedure (microplate standard, microplate reduced-sample, test-tube
standard, test-tube enhanced) and get the working reagent volumes for the plate you are about to
run. The procedure decides sample volume, reagent volume and working range, so it is chosen once
and read everywhere.

**Dilutions** — the BSA serial dilution plan, from the 2 mg/mL ampule down. Three presets,
including the two tables from the Pierce manual and the lab's own serial series.

**Analysis** — paste the reader's grid, name the unknowns, and read off the curve, the
concentrations and the loading volumes. Every stage recomputes from the one before it. Correcting
a single well re-fits the curve and everything downstream; changing the loading target recomputes
the loading table and touches nothing above it.

Exports are CSV and JSON, built as a Blob and downloaded by the browser — the same promise as
above, restated as a refusal.

## What was ported, and what was not

`BCA_quarto` shipped a Quarto site with Shinylive blocks: Python calculations compiled to WASM,
inlined into each `.qmd` by a generator, with a drift test to stop the inlined copies diverging
from `src/`. The arithmetic came across intact — the workbook's coefficients reproduce to the
last digit, and `domain/reference.ts` pins them. The machinery around it did not, because it was
never about the assay: it was the cost of running Python in a browser.

The 12 `F**.feature.md` files came across as 19 `.feature` files. Each one names its origin in a
header comment. `features/README.md` maps them.

## Layout

```
src/domain/    the assay. Pure functions, no I/O, no framework. 100% covered.
src/schemas/   Zod at every boundary — paste, file, localStorage.
src/state/     signals and the derived pipeline: plate → mapping → curve → samples → loading
src/ui/        Preact components. The only layer that renders anything.
features/      the specification (see features/README.md)
```

Dependencies run one way — `ui → state → schemas/domain` — and ESLint enforces it. `domain/` and
`schemas/` may not import outward at all.

Two conventions carry most of the weight:

**Issues are data, never exceptions.** Each stage returns its value paired with its complaints,
so a stage that fails degrades its own panel and leaves the others rendered. A plate that will
not parse leaves the curve reporting *why*, rather than computing from the previous plate's
numbers.

**The chart enhances and never gates.** Every number in it is also in the table beside it.
Identity is carried by shape as well as hue, out-of-range samples are hollow rather than
differently coloured, the marks are real focusable buttons over the canvas, and hover, click and
keyboard focus all reach the same readout. A reader who is colourblind, on greyscale, using a
screen reader, or with reduced motion set loses nothing but convenience.

## Tests

`npm run verify` runs four projects:

| Project | Where | Tests |
|---|---|---|
| `unit` | node | 493 |
| `acceptance` | node | 232 scenarios, 16 features |
| `component` | Chromium | 9 |
| `acceptance:ui` | Chromium | 43 scenarios, 4 features |

786 in total, all passing, no skips and no `@todo` tags.

The workflow is spec-first: a `.feature` file exists before the code that satisfies it, and every
feature carries negative scenarios as well as happy paths. See `AGENTS.md` before changing
anything, and `features/README.md` before adding a scenario.

## Stack

Preact 10 · @preact/signals · Vite 8 · Vitest 4 · QuickPickle · Zod 4 · Tailwind 4 · ECharts 6 ·
TypeScript 6. Versions are pinned; the traps behind several of those pins are listed in
`AGENTS.md`.
