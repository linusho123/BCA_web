# AGENTS.md — working on BCA_web

This project follows the ABDD workflow from `~/Documents/webdev_ref/`. Read that library's
`AGENTS.md` and `docs/04-abdd-workflow.md` for the method. This file covers what is specific to
this repo.

## 0. Before you change anything

```sh
npm run verify
```

It should be green: gherkin-lint, eslint, `tsc --noEmit`, 764 tests. If it is not green when you
arrive, find out why before writing anything — a red gate you did not cause is the most useful
thing you will learn all session.

## 1. Hard rules

- **No implementation code before a `.feature` file exists for it.** If a change alters what the
  app promises, the promise changes first, in `features/`. `npm run lint:features` must pass
  before any code is written.
- **Every scenario set includes negative scenarios.** A feature with only happy paths is not
  done.
- **Validate every external input with Zod.** Pasted text, uploaded files, `localStorage`. No
  unvalidated `any` crosses a boundary. See `src/schemas/`.
- **Pin versions.** They come from `webdev_ref/reference/versions.md`. If you need one that is
  not listed, verify it on the registry and say so explicitly.
- **Do not add a dependency** without stating the reason and the alternative you rejected.

## 2. The two invariants this app is built on

Break either and the failure will be quiet, so they are stated here rather than left to be
inferred from the code.

**Issues are data, not exceptions.** No domain function throws across a stage boundary. Each
returns its value paired with its complaints, and `src/state/stage.ts` tags them with the stage
they came from — once, in one place. This is what lets a failed plate leave the loading panel
rendered and reporting *why* rather than taking the page down or, worse, computing from stale
numbers.

The one deliberate exception is `predict()` in `domain/curve.ts`, which throws
`CurveNotFittedError` on a curve with no coefficients. It is called only behind a `fit.fitted`
check. Do not call it anywhere else.

**The chart enhances and never gates.** Every number in the plot is also in the table beside it.
Identity is carried by shape as well as hue; out-of-range samples are hollow rather than
recoloured; the marks are real focusable buttons positioned over the canvas, because a canvas has
no DOM and nothing in it can be tabbed to. If you touch `src/ui/chart/`, the presentation feature
is what tells you whether you broke this.

## 3. Layering

```
ui → state → schemas/domain
```

ESLint enforces it with `no-restricted-imports`. `domain/` and `schemas/` may not import from
`ui/`, `data/` or `state/` at all — that purity is what lets 16 of the 18 features run in node in
milliseconds instead of in a browser.

The one exemption is `features/steps/ui/**`, which must mount the UI it tests. That is scoped to
that directory in `eslint.config.js`; do not widen it.

## 4. Tests

| Project | Where | Command |
|---|---|---|
| `unit` | node | `npm run test:unit` |
| `acceptance` | node | `npm run test:acceptance` |
| `component` | Chromium | `npm run test:component` |
| `acceptance:ui` | Chromium | `npm run test:acceptance:ui` |

Coverage thresholds are 100% on `src/domain/**` and `src/schemas/**`. That is not a target to
grind toward; it is a statement that a line of assay arithmetic nothing exercises should not
exist.

Do not run `--project=component --project=acceptance:ui` together — two browser projects in one
invocation drops the Playwright connection mid-run. Run them separately.

### The gate is not the whole app

Every project above mounts components. None of them loads `index.html`, runs the real entry
point, or clicks a link in the nav. Three defects have been found by `npm run build && npm run
preview` and driving the result — a chart that never initialized, a raw float in a pipetting
column, and a wall of errors on every return visit — after a fully green gate. Do that before
calling a change done, and read the browser console while you are there.

### Things that will bite you in the browser projects

- **Vitest 4 locators are synchronous.** `.all()` and `.element()` return values, not promises.
  Awaiting one is a lint error, not a slow test.
- **`userEvent.hover` parks the real cursor and leaves it there.** A later scenario that
  re-renders puts a fresh element under that stationary pointer, `mouseenter` fires, and your
  keyboard assertion gets answered by the mouse. `parkPointer()` in `curve-plot.steps.tsx` exists
  for this.
- **The browser steps read numbers off the signals, never out of table cells.** A cell is rounded
  for a reader; a scenario asserting a value *changed* would pass on two numbers that round the
  same way. Read the DOM only for what only the DOM can answer.
- **Signals are module-level.** The app has one analysis, not one per component, so a scenario
  must put the state back. `features/steps/ui/support.tsx` does that once in a `Before` hook for
  both browser features.

## 5. Version traps (as of 2026-08-11)

| Trap | Rule |
|---|---|
| TypeScript 7 has no stable programmatic API | `typescript-eslint@8` needs `<6.1.0`. Pinned at `6.0.3`. |
| Preact 11 is RC | `preact@10.29.x`. |
| Vitest 4 removed `vitest.workspace.ts` | `test.projects` in `vite.config.ts`. |
| Vitest 4 browser mode needs a provider package | `provider: playwright()`, not `'playwright'`. |
| `gherkin-lint` is abandoned | `gherkin-lint-plus`. |
| TanStack has Preact adapters | `@tanstack/preact-table`, never the React one via compat. |
| Vite optimizes deps on first import | Browser mode reloads mid-run and you end up with two Preact instances sharing no hook state. Everything the browser projects import is pre-listed in `optimizeDeps.include`. Add to it when you add a dep they use. |

## 6. Reporting

When you finish a unit of work:

- **Scenarios passing:** by name.
- **Scenarios pending:** any `@todo`/`@wip` and why. There are currently none — keep it that way
  or say plainly that you did not.
- **Gate status:** the output of `npm run verify`, verbatim if it failed.
- **Deviations:** anything done differently from the reference library, and why.

Do not call a feature done while any of its scenarios are skipped.
