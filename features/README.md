# The specification

These 22 feature files are the specification. Not a description of the code — the thing the code
is written to satisfy, and the reason to believe it still does. If a claim about this app is not
in here, nothing is checking it.

Every scenario runs on every `npm run verify`. There are no `@todo` or `@wip` tags in this
directory; a scenario that cannot pass yet does not get written as a scenario.

## Where each one runs

| Layer | Runner | What it can see |
|---|---|---|
| `unit` | node | one exported function |
| `acceptance` | node | the domain, through the sentences a researcher would use |
| `component` | Chromium | one rendered component |
| `acceptance:ui` | Chromium | the whole page, focus and all |

The split is in `vite.config.ts`, not in how the features are written. Fifteen of the twenty-five
are claims about the assay and run in node in milliseconds. Ten are claims about a rendered
page — that focus reaches what hover reaches, that a failed stage leaves its neighbours drawn,
that a restored session asks for a plate rather than listing what is missing, that a pointer on a
crowded mark reads back that mark, that the standards table names the tube each well was read
against, that a button held down across a row paints every well it enters, that a setting chosen on
one page is stored from that page — and those cannot be
checked without a browser, so they run in one. A scenario can move between the two without being
rewritten.

## The map

| Feature | Scenarios | Proves | Ported from |
|---|---|---|---|
| `health/toolchain.feature` | 2 | the gate itself runs | — |
| `curve-fitting/polynomial-least-squares.feature` | 9 | `domain/linalg` | F01 |
| `curve-fitting/standard-curve.feature` | 11 | `domain/curve` | F05 |
| `curve-fitting/curve-quality-guards.feature` | 11 | `domain/curve`, negative half | F05 |
| `dilution/serial-dilution-plan.feature` | 12 | `domain/dilution` | F02 |
| `dilution/dilution-series-validation.feature` | 7 | `domain/dilution`, negative half | F02 |
| `plate/plate-reader-paste.feature` | 12 | `domain/plate` | F03 |
| `plate/plate-file-import.feature` | 10 | `schemas/upload`, `domain/plate` | F11 |
| `plate/well-region-mapping.feature` | 12 | `domain/layout` | F11 |
| `plate/default-plate-layout.feature` | 12 | `domain/layout` | F11 |
| `qc/replicate-statistics.feature` | 10 | `domain/qc` | F04 |
| `samples/sample-back-calculation.feature` | 12 | `domain/samples` | F06 |
| `reagent/working-reagent.feature` | 10 | `domain/reagent` | F08 |
| `export/result-export.feature` | 11 | `domain/export` | F09 |
| `analysis/curve-plot-geometry.feature` | 12 | `domain/plot` | F12, geometry half |
| **`analysis/analysis-workflow.feature`** | 12 | the page, the pipeline, the promises | replaces F10 |
| **`analysis/session-continuity.feature`** | 4 | the page before a plate is in it | replaces F10 |
| **`analysis/curve-plot-presentation.feature`** | 12 | the rendered chart | F12, presentation half |
| **`analysis/curve-plot-crowding.feature`** | 2 | which mark the pointer is asking about | split from presentation |
| **`analysis/plate-grid.feature`** | 9 | the 96 wells, typed into | scoped 2026-08-11 |
| **`analysis/plate-layout-painting.feature`** | 11 | which wells hold which sample | scoped 2026-08-11 |
| **`analysis/plate-paint-drag.feature`** | 8 | painting a run of wells in one gesture | ruled 2026-08-12 |
| **`analysis/settings-persistence.feature`** | 8 | a setting is stored from whichever page set it | ruled 2026-08-12 |
| **`analysis/plate-grid-from-file.feature`** | 12 | reading a plate out of a file | scoped 2026-08-11 |
| **`analysis/standards-direction.feature`** | 8 | which end of the row the series starts at | scoped 2026-08-12 |

Bold runs in a browser. "Ported from" is the `BCA_quarto/features/F**.feature.md` file; each
feature repeats its own provenance in a header comment, including which section of the spec
document it came from. Of the browser features, three came from a `/scope`
interview rather than from the Quarto project — the grid, the painting and the file import — and
their scope fence, what was deliberately left out and which rejected options were considered, is
in `spec/OUT-OF-SCOPE.md`. `standards-direction.feature` came later still, from a bench that
pipettes its series the other way; its header carries its own reasoning. `plate-paint-drag.feature`
is later again and is the one file here that amends a fence rather than filling a gap: the
sanctioned-changes table records why, and the fence entry it narrows is "Selecting wells".
`settings-persistence.feature` is later still and came from a defect rather than from a request:
`session-continuity.feature` promised that the settings survive a reload and was green, because
every setting it named was set on the page that did the writing. The procedure was not. That is
worth reading as a lesson about scope rather than about persistence — a promise made for a
category is only kept for the members the mechanism happens to reach, and the gap is invisible
from inside the file that made the promise.

F10 is the one that did not survive. It specified a Quarto site with Shinylive blocks: a purity
constraint so the core could run under Pyodide, a generator that inlined it into each `.qmd`, and
a drift test to stop the copies diverging. None of that was about the assay — it was the cost of
running Python in a browser, and the port does not pay it. What was load-bearing in F10 is the
first half of `analysis-workflow.feature`.

## Step definitions

```
features/support/world.ts     the typed world and the Gherkin phrase parsers
features/steps/index.ts       the node registry — importing a module registers its steps
features/steps/ui/index.ts    the browser registry
features/steps/ui/support.tsx mounting, DOM queries, and the network/storage watches
```

QuickPickle's registry is per-setup-file, so a sentence registered in `steps/` and a sentence
registered in `steps/ui/` may be worded identically without colliding.

Two conventions worth knowing before editing a step:

- **Every `expect` carries a message naming what failed.** A failing acceptance test that says
  only "expected true to be false" costs a trip into the domain to find out which code came back.
- **The browser steps read numbers off the signals, not out of the table cells.** A cell is
  rounded for a reader, and a scenario asserting that a concentration *changed* would pass on two
  different numbers that round the same way. What is read from the DOM is what only the DOM can
  answer.

## The flake, and why it was the grid

One `acceptance:ui` run failed with 2 failed, 74 passed, and the log was not kept. It is fixed,
and the way it hid is worth more than the fix.

**The cause.** Two scenarios claim that every plotted point is reachable *in the tab order*. That
can only be shown by tabbing — `.focus()` succeeds on elements a keyboard user can never reach —
so they press Tab once per focusable element on the page. When those scenarios were written the
page held about a dozen controls. Then `plate-grid.feature` added the 96-well grid, and 96 of the
page's 107 focusable elements became wells. At ~18 ms per Tab through the browser, an honest step
now needs **~1,900 ms against QuickPickle's 3,000 ms default**. Under `npm run verify`, where two
Chromium projects run at once, that margin is not enough and the two steps time out. `stepTimeout`
is now 15 s, and the reasoning is in `vite.config.ts`.

Nothing was wrong with the app. A feature that never mentions the keyboard made an unrelated
keyboard scenario three times more expensive, and the cost landed on a limit nobody re-examined.
That is the kind of coupling a scenario cannot state about itself.

**Why 70 runs missed it.** Every hunt ran `acceptance:ui` alone; the failure only appears when the
whole suite runs, because it needs the second browser project competing for the machine. Isolating
the suspect removed the cause. Reproduce with `npx vitest --run` on a loop, not the project alone
— roughly one run in three failed before the fix, and 9 of 9 passed after.

**What dated it.** 2 + 74 = 76, and 76 was the `acceptance:ui` total for exactly two commits,
`8864bf7` and `16e9672` — both after the grid landed, which fits.

```
npm run flake-hunt                       # 20 runs, keeps the log of any run that fails
npm run flake-hunt -- --project=all      # every project at once — what the timeout flake needed
npm run flake-hunt -- --cold             # clear the Vite prebundle first, every run
```

The rerun-on-failure setting Vitest offers would have been the wrong instrument here: it hides
exactly the log this needed. `scripts/flake-hunt.mjs` keeps it instead, under `.flake/`.

The search also turned up two things that were not the cause and are worth keeping:

| Suspect | Verdict |
|---|---|
| tab budget outgrown by the 96-well grid | **the cause**, fixed |
| `lucide-preact` missing from `optimizeDeps.include` | a real defect, fixed, unrelated |
| `-9999` sentinel for an unmeasured mark reaching a geometric step | plausible, never observed; the wait that allowed it is now closed |

The lucide one is worth reading even though it is not the answer. Vite optimizes a dependency the
first time it is imported, and in browser mode that reload lands mid-run: a component that
imported `preact/hooks` before it holds hooks from one prebundle while `preact` came from
another, and every render throws `reading 'context'`. `lucide-preact` calls `useContext` and was
never in the include list. A probe that mounted `App` in the `component` project failed 40 times
out of 40 and passed 40 out of 40 with the one line added. It does not explain the
`acceptance:ui` failure because Vite's scanner already reaches it there — `features/steps/ui/index.ts`
statically imports step files that import `App` — so it was being prebundled in that project
anyway. It reached the `component` project only when the persistence work first mounted the shell
in a browser step, which is the same week the flake was seen. Close, and still a coincidence.

The dropped suspect is worth keeping written down, because the mistake in it is easy to make
again. `curve-plot-crowding.feature` has two *scenarios*, and "2 failed" looked like a match. It
is not one: one of those scenarios is a four-example Outline, so the file is five *tests*, and
tests are what the summary line counts. Two failures cannot be that file failing wholesale — a
mutation confirmed it, reporting 4 failed rather than 2. A scenario count and a test count are
different numbers wherever an Outline is involved, and only one of them is the one being
compared against.

What that file did leave behind is a real defect in the harness, found by looking rather than by
reproducing. Its steps are the only ones that ask the browser for true geometry —
`getBoundingClientRect`, `document.elementFromPoint` — and they inherit the `drawn()` wait from
`curve-plot.steps.tsx`, which waited on the mark *count* alone. A point ECharts cannot place yet
is rendered at an off-canvas sentinel rather than dropped, so it counted as drawn while sitting
nowhere a pointer could reach. `drawn()` now waits for the marks to be placed as well as present.
Forcing every mark to the sentinel fails those scenarios with the wait in place, so the guard is
doing work; whether that race ever fired in a real run remains unproven.

If it happens again the log will be under `.flake/`, and this section can stop being a list of
things that are not the answer.

## Writing a new one

The loop is `docs/04-abdd-workflow.md` in the reference library, and it does not start with code:

```
spec → lint spec → step defs (red) → unit tests (red) → implement → green → gate
```

Two rules from `AGENTS.md` that this repo has not broken yet and should not:

1. No implementation code before a `.feature` file exists for it.
2. Every scenario set includes negative scenarios. A feature with only happy paths is not done.

`npm run lint:features` must pass before any code is written.
