# The scope fence — plate grid and file import

Scoped 2026-08-11 with `/scope`. Companion to the three `.feature` files beside it.

Declined scope fences the outside; rejected options pin the inside. Both are here so that a
later reader finds a decision where they would otherwise find an open question.

## Where these files live, and why not in `features/`

`vite.config.ts:94` globs `features/**/*.feature` into the `acceptance` project. A scenario
landing there runs on the next `npm run verify` against a step registry that has nothing to
bind it, and the gate goes red — against `AGENTS.md` rule 0 and the README's claim of no skips
and no `@todo` tags. `spec/` is globbed by nothing.

Move each file to `features/analysis/` as its steps are written. A file whose subject is the
rendered page must also be added to `UI_FEATURES` in `vite.config.ts` in the same commit, or it
runs in node against the browser step registry. All three of these are page-subject files.

## Out of scope

| Item | Why it is out |
|---|---|
| Importing a colleague's file, an archived plate, or another lab's export | The importer is the person who ran the plate — the file is minutes old and they know its layout. Provenance display, unfamiliar export shapes and instrument dialects all follow from the case that was declined. |
| Partial-plate imports — fewer than 8 rows | Ruling 12 accepts exactly 8 by 12. The cost was stated when the ruling was made: a reader that exports only the rows used cannot be imported. Hand-typing a partial plate is unaffected. |
| 384-well plates | The grid is 96 wells. `parsePlate` takes row and column counts and would not object, but nothing in this contract covers a larger grid. |
| XLSX import | Needs a dependency that can read a ZIP of XML; `AGENTS.md` requires the reason and the rejected alternative stated first. Undecided here rather than declined — a workbook with several sheets needs its own rulings. Plate readers export CSV, and Excel's Save As is one step. |
| Editable standard concentrations | Ruling 5 fixed standards to the lab series in plate order. A plate run against a different series cannot be described. |
| Choosing between two grids in one file | Ruling 11 refuses instead of asking. The refusal names the count so the researcher knows what to re-save. |
| Requiring every measured well to carry a role | Ruling 2. A number in an unassigned well is left out silently. |
| Keeping absorbances past the tab, and warning before losing them | Ruling 7, upheld against objection 2. Nothing an instrument produced is written where it outlives the tab. |
| Whether the layout should still persist between visits at all | Ruling 9 wipes the painting as soon as a plate arrives, which weakens layout persistence to the same-tab case. Left as its own decision rather than settled by accident here. |
| Renaming or deleting a sample that already has wells painted | Raised at Phase 5 and declined. Nothing states whether painting follows a rename or is orphaned. The builder will meet this; it is unruled, not ruled. |
| Undo for anything but an import | Ruling 6 gave import an undo. Painting, erasing and typing have none, and none was asked for. |
| Every stack question | Implementation decisions deferred: how the grid is rendered, how 96 inputs are held, how tab-lifetime storage is achieved, what reads the file. None of it belongs in a reviewed feature file. |

## Sanctioned changes

Changes this contract makes to behavior that is already specified and green. Written before
build so that a sanctioned flip and a silent weakening do not leave the same history.

| Scenario | File | What changes | Ruling |
|---|---|---|---|
| Running an analysis sends nothing over the network | `features/analysis/analysis-workflow.feature` | Its step *no assay value is written to persistent storage* must distinguish storage that outlives the tab from storage that does not. Ruling 7 puts typed absorbances in the second. The promise narrows in wording and holds in substance; if the step cannot be narrowed honestly, ruling 7 is what gives way. | 7 |
| Wells nobody assigned are left out without comment | `plate-layout-painting.feature`, `src/domain/plate.ts` | **Done 2026-08-12.** The plate-wide `NON_NUMERIC_CELL` INFO note listing every empty well is removed; the empty well worth reporting is one inside an assigned region, raised by `readWells` and named against its sample by `mapSamples`. One unit test flipped (`summarises empty wells into one line`), replaced by `says nothing at all about an un-plated well`. The scenario's step was strengthened first and failed on exactly the six wells the note named — the weak version had been passing while the behaviour was wrong. | 3 |
| The layout and settings are restored after a reload | `features/analysis/session-continuity.feature` | Still passes as written — a reload restores the layout, and under ruling 7 a same-tab reload restores the numbers too, so nothing is "new" and nothing clears. Recorded because ruling 9 makes the scenario's *value* conditional on the tab surviving. | 9 |

Harness note, not a scenario: `features/steps/ui/support.tsx:75` uses `plate-input` to detect
whether the app is mounted, and `features/steps/ui/curve-plot.steps.tsx:134` parks the mouse
pointer on it. Ruling 8 keeps the paste box, so both survive. Removing it later breaks two step
files silently.

## Roads not taken

Contested rulings, and the options rejected. One line each on why.

**Who imports** — colleague's file, archived plate, other-lab export were all rejected in favor
of *the person who ran the plate*. The narrow case is the real one; the others would have
pulled provenance and format tolerance into scope.

**What "ready" means** — *every measured well must have a role* rejected as nagging about
leftovers; *ready means the concentrations came out* rejected as too loose to specify against.

**Empty wells** — *say nothing at all* rejected because a blank well inside a declared sample is
real missing work; *keep today's info note* rejected because a 96-well grid makes it permanent.

**Selecting wells** — *drag a rectangle* rejected because a skipped bad well needs a second
drag; *click one well at a time* rejected as slower than painting across a row. Painting won on
laying out a whole plate without typing a name twice.

**Standards** — *editable per well* and *paint each concentration separately* both rejected;
nine paint passes for a series that never varies, against zero for plate order.

**Messy files** — *show what it found and let you choose* rejected as interrupting every import;
*refuse anything not a bare grid* rejected because instrument headers are normal. Finding the
grid past metadata won, then objection 3 narrowed it: refusal returned for the ambiguous case
only.

**Losing typed work** — *keep on this machine until cleared* rejected as breaking the promise
outright; *gone but warn first* and *gone silently* rejected as too expensive once someone is
typing 40 wells by hand.

**Objection 2, tab-lifetime storage** — *show that you are holding it*, *do not store at all*,
and *drop after inactivity* were all put and all rejected. Ruling 7 upheld unchanged: an
unlocked laptop someone walked away from is not a threat a web page can fix.

**The textarea** — *grid replaces it* and *paste box on demand* rejected in favor of keeping
both; paste is still the fastest way in when the clipboard already holds the plate.

**What clears the painting** — *import clears but paste does not* rejected as two similar acts
with different consequences; *nothing clears automatically* rejected despite the argument that a
painted grid makes staleness visible; *clears but offers itself back* rejected as a half
measure. One rule won: any new plate data clears it.

**Objection 1, pre-painted standards** — *a usual-layout button*, *clearing spares the
standards*, and *paint every time* rejected. Pre-painting won because rows A and B never vary in
this lab and the alternative made the common plate more work than it is today.

**Objection 4, plate shape** — *up to 8 rows*, *whatever shape the file holds*, and *96 now with
384 deferred* rejected in favor of exactly 8 by 12, knowing it refuses a genuine partial run.

**Objection 5, colour and the keyboard** — *assignments listed beside the grid*, *names now and
keyboard later*, and *take the exception deliberately* rejected. Names in the wells plus
keyboard painting won, because painting gates the analysis where the chart only enhances it.

## Two bars this contract depends on and cannot enforce

A bound scenario's green counts only under **mutation-checking**: doctor the world the scenario
describes and the verdict must flip. A scenario that passes against a broken app is worth less
than no scenario, because it also reports that the area is covered.

Assertions bind **far-side**: ground truth is never an artifact the system under test wrote.
`Then well "C1" holds 0.430` is read off the rendered grid or the analysis the rest of the page
consumes — never off the same string the import step just handed the parser.
