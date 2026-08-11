# The specification

These 18 feature files are the specification. Not a description of the code — the thing the code
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

The split is in `vite.config.ts`, not in how the features are written. Sixteen of the eighteen
are claims about the assay and run in node in milliseconds. Two are claims about a rendered page
— that focus reaches what hover reaches, that a failed stage leaves its neighbours drawn — and
those cannot be checked without a browser, so they run in one. A scenario can move between the
two without being rewritten.

## The map

| Feature | Scenarios | Proves | Ported from |
|---|---|---|---|
| `health/toolchain.feature` | 2 | the gate itself runs | — |
| `curve-fitting/polynomial-least-squares.feature` | 9 | `domain/linalg` | F01 |
| `curve-fitting/standard-curve.feature` | 11 | `domain/curve` | F05 |
| `curve-fitting/curve-quality-guards.feature` | 11 | `domain/curve`, negative half | F05 |
| `dilution/serial-dilution-plan.feature` | 11 | `domain/dilution` | F02 |
| `dilution/dilution-series-validation.feature` | 7 | `domain/dilution`, negative half | F02 |
| `plate/plate-reader-paste.feature` | 12 | `domain/plate` | F03 |
| `plate/plate-file-import.feature` | 10 | `schemas/upload`, `domain/plate` | F11 |
| `plate/well-region-mapping.feature` | 12 | `domain/layout` | F11 |
| `plate/default-plate-layout.feature` | 11 | `domain/layout` | F11 |
| `qc/replicate-statistics.feature` | 10 | `domain/qc` | F04 |
| `samples/sample-back-calculation.feature` | 12 | `domain/samples` | F06 |
| `samples/loading-plan.feature` | 12 | `domain/samples` | F07 |
| `reagent/working-reagent.feature` | 10 | `domain/reagent` | F08 |
| `export/result-export.feature` | 12 | `domain/export` | F09 |
| `analysis/curve-plot-geometry.feature` | 12 | `domain/plot` | F12, geometry half |
| **`analysis/analysis-workflow.feature`** | 12 | the page, the pipeline, the promises | replaces F10 |
| **`analysis/curve-plot-presentation.feature`** | 12 | the rendered chart | F12, presentation half |

Bold runs in a browser. "Ported from" is the `BCA_quarto/features/F**.feature.md` file; each
feature repeats its own provenance in a header comment, including which section of the spec
document it came from.

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

## Writing a new one

The loop is `docs/04-abdd-workflow.md` in the reference library, and it does not start with code:

```
spec → lint spec → step defs (red) → unit tests (red) → implement → green → gate
```

Two rules from `AGENTS.md` that this repo has not broken yet and should not:

1. No implementation code before a `.feature` file exists for it.
2. Every scenario set includes negative scenarios. A feature with only happy paths is not done.

`npm run lint:features` must pass before any code is written.
