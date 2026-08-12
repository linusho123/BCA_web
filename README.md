# BCA_web

Pierce BCA protein assay: plan the dilution series, fit the standard curve, and back-calculate the
unknowns. A port of `BCA_quarto` from Quarto + Shinylive to a Preact app.

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

Node `>=22.12.0`. `npm run dev` opens a browser; it will not appear on its own otherwise.

## Deploying it

`npm run build` writes `dist/` — an `index.html` and two files, about 700 KB. There is no server
and no backend, so any static host will serve it. Assets are referenced relatively (`base: './'`
in `vite.config.ts`), so it runs from a sub-path as happily as from a domain root, and routing is
by hash, so the host needs no rewrite rules.

This repo is live at **<https://linusho123.github.io/BCA_web/>**.

`.github/workflows/deploy.yml` publishes there on every push to `master` or `main`. It runs
`npm run verify` first and the deploy depends on it, so a red suite does not become a published
site. It is already switched on; setting it up again elsewhere is two commands:

```sh
gh repo create BCA_web --private --source=. --push   # or add a remote by hand and push
gh api -X POST repos/:owner/BCA_web/pages -f build_type=workflow
```

Or in the web UI: **Settings → Pages → Source → GitHub Actions**. The workflow needs no secret —
it deploys through `id-token`, so there is nothing to rotate.

**The repository is private; the published site is not.** Those are two different switches, and
GitHub only ties them together on paid plans. On this account a private repo still serves a
world-readable Pages site, so anyone with the URL can open the app and download the offline copy
without a GitHub account — which is exactly what makes it shareable with the lab, and worth
saying out loud so it is never mistaken for access control. The *code* stays private; the *app*
is public to anyone holding the link.

That is safe for the reason the top of this file gives: the whole calculation runs in the
browser, so publishing the app does not publish anyone's data. Absorbances never leave the
machine that entered them and are held only for the tab. What is public is the app and, through
it, the worked example and the lab's dilution presets — nothing anyone runs through it.

To make the site private too, the repo needs GitHub Pro or Team, then **Settings → Pages →
Visibility → Private**; readers then need GitHub accounts with repo access.

### Sharing it with people who will not use a terminal

Send them the URL: **<https://linusho123.github.io/BCA_web/>**. Nothing to install, works on any
machine, no GitHub account, and everyone is on the current version the moment it is pushed. That
is the right answer for almost everybody, and the rest of this section is for the people it is
not the right answer for.

#### The offline copy — one file, no terminal, no install

For a bench laptop with no network, a shared instrument PC, or a frozen copy of the exact
version used for a figure, the whole app also exists as **one HTML file of about 700 KB**.

**To get it, with no commands at all:** open
**<https://linusho123.github.io/BCA_web/bca-web.html>**, then save the page —
`Cmd`/`Ctrl` + `S`, or right-click → *Save Page As…* — choosing **"Webpage, HTML Only"** if the
browser offers a choice. That saved file *is* the app. There is nothing else to download.

**To use it:** double-click it. It opens in the browser and works, offline, with no server, no
install and no terminal. Email it, drop it on a USB stick, put it on the shared drive — it is a
single file and it keeps working wherever it lands. Verified from `file://`, including import,
painting, the worked example, and the dilution and protocol pages.

Two notes for whoever hands it out. "HTML Only" matters: the *Complete* option writes a folder
of extra files alongside it, which is harmless but no longer a single thing to email. And on
Windows, browsers sometimes mark a downloaded HTML file as blocked — if it opens blank, right-
click → *Properties* → **Unblock**.

**To rebuild it from source** (only needed to cut a copy of an unpushed change):

```sh
npm run build:standalone   # writes dist/bca-web.html
```

The deploy runs that on every push, which is why the URL above always serves the current build.

The trade-off is the obvious one: a downloaded copy is frozen. Someone using a file from March
is using March's arithmetic. If people are going to keep copies, tell them where the URL is so
they can check they are current — and put the date in the filename before you send it, because
`bca-web.html` on a shared drive tells nobody which version it is.

## The three pages

**Protocol** — pick a procedure (microplate standard, microplate reduced-sample, test-tube
standard, test-tube enhanced) and get the working reagent volumes for the plate you are about to
run. The procedure decides sample volume, reagent volume and working range, so it is chosen once
and read everywhere.

**Dilutions** — the BSA serial dilution plan, from the 2 mg/mL ampule down. Three presets,
including the two tables from the Pierce manual and the lab's own serial series.

**Analysis** — paste the reader's grid, name the unknowns, and read off the curve and the
concentrations. Every stage recomputes from the one before it. Correcting a single well re-fits
the curve and everything downstream; changing the dilution factor rescales the stock column and
touches nothing above it.

Exports are CSV and JSON, built as a Blob and downloaded by the browser — the same promise as
above, restated as a refusal.

## The recovery warning

The standards table has a **Recovery** column, and a standard outside 80–120 % raises a warning
like this one:

> standard H back-calculates to 134.0 % of its nominal value, outside 80-120 %

**Nominal** is the concentration you believe you pipetted into that tube — 25 µg/mL for tube H in
the worked example. It comes from the dilution plan, not from the plate reader.

**Back-calculated** is what the fitted curve says that tube held, given the absorbance it actually
read. It is the same calculation the app does for an unknown, run on a standard whose answer is
already known. In code it is `polyval(coefficients, absorbance)` in `domain/curve.ts`.

```
recovery % = 100 × (what the curve says the tube held) ÷ (what you meant to put in it)
```

100 % means the curve reproduces that standard exactly. The bounds are
`RECOVERY_LOW_PERCENT = 80` and `RECOVERY_HIGH_PERCENT = 120` in `domain/constants.ts`.

Two details worth knowing before you read a number:

- **The blank has no recovery.** Its nominal is 0, and dividing by it is undefined, so the column
  shows a dash rather than a number. Same for any level dropped before the fit.
- **The absorbance is blank-corrected first,** when blank subtraction is on. Tube H reads 0.159
  against a blank of 0.132, so the curve is asked about 0.027, not 0.159.

### Why H reads 134 % in the worked example

That number is real, not a bug, and it is a property of the lab's own reference data — pinned as
a scenario in `curve-fitting/standard-curve.feature`, which asserts H at about 134 % and every
other standard between 80 and 120 %. The rest of the series recovers between 91.7 % and 104.4 %.

H is the lowest non-zero standard, at 25 µg/mL. After blank correction it is 0.027 absorbance
units above nothing, which is inside the reader's own noise. The fitted cubic has an intercept of
+13.8 µg/mL — at zero absorbance the curve does not pass through zero — and 13.8 is already 55 %
of 25. So the curve says 33.5 where you meant 25, and a 8.5 µg/mL miss on a tube this small is
34 %. The same absolute error at tube C (1000 µg/mL) would be under 1 %.

**What to do about it.** A single low standard over 120 % is the ordinary shape of a BCA curve at
the bottom of its range, and it is a reason to distrust *unknowns that read near that end*, not
the curve as a whole. If your samples read in the middle, it does not affect them. If they read
down at H, dilute less and re-run so they land higher on the curve. A standard in the middle of
the series recovering badly is a different matter — that is a pipetting error in the series, and
the tube it names is the one to re-make.

## What was ported, and what was not

`BCA_quarto` shipped a Quarto site with Shinylive blocks: Python calculations compiled to WASM,
inlined into each `.qmd` by a generator, with a drift test to stop the inlined copies diverging
from `src/`. The arithmetic came across intact — the workbook's coefficients reproduce to the
last digit, and `domain/reference.ts` pins them. The machinery around it did not, because it was
never about the assay: it was the cost of running Python in a browser.

The 12 `F**.feature.md` files came across as 19 `.feature` files, and three more were scoped
since. Each one names its origin in a header comment; `features/README.md` maps all 22.

## Layout

```
src/domain/    the assay. Pure functions, no I/O, no framework. 100% covered.
src/schemas/   Zod at every boundary — paste, file, localStorage.
src/state/     signals and the derived pipeline: plate → mapping → curve → samples
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
| `unit` | node | 503 |
| `acceptance` | node | 213 scenarios, 15 features |
| `component` | Chromium | 9 |
| `acceptance:ui` | Chromium | 76 scenarios, 7 features |

801 in total, all passing, no skips and no `@todo` tags.

The workflow is spec-first: a `.feature` file exists before the code that satisfies it, and every
feature carries negative scenarios as well as happy paths. See `AGENTS.md` before changing
anything, and `features/README.md` before adding a scenario.

## Stack

Preact 10 · @preact/signals · Vite 8 · Vitest 4 · QuickPickle · Zod 4 · Tailwind 4 · ECharts 6 ·
TypeScript 6. Versions are pinned; the traps behind several of those pins are listed in
`AGENTS.md`.
