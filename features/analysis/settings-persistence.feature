# What gets written when a setting changes, and from which page.
#
# Ruled 2026-08-12. session-continuity.feature already says the settings survive a reload, and
# it passes, because every setting it names is set on the analysis page — the one page that runs
# the effect that writes them. The procedure is set on the protocol page, and nothing there
# writes anything. That is the gap: the promise was made once, for all settings, and kept by a
# mechanism that only covers one page's worth of them.
#
# Measured on the shipped build before this was written, because the failure is not the obvious
# one. It is not that the procedure fails to persist — it is that it persists *late*, off the
# back of the analysis page mounting, so the two stores disagree in a way that only shows up on
# the next reload:
#
#   1. Choose "Test tube, enhanced" on the protocol page.   Storage: nothing at all.
#   2. Visit the analysis page.                             Storage: test_tube_enhanced.
#   3. Go back and choose "Microplate, reduced sample".     Screen: reduced. Storage: enhanced.
#   4. Reload.                                              Screen: enhanced. The choice is gone.
#
# So the screen and the store disagree between steps 3 and 4, and the reload resolves the
# disagreement in favour of the value nobody chose. Nothing is reported, because from the app's
# side nothing went wrong: it restored exactly what it had been given.
#
# This matters at the bench rather than only on screen. The procedure sets the sample volume,
# the reagent volume, the incubation, and the working range the QC flags are judged against —
# 5-250 ug/mL for the enhanced test-tube protocol against 20-2000 for the microplate standard.
# A stale procedure re-flags every sample on the plate, and the reagent volumes on the protocol
# page are for an assay the person is not running.
#
# The fix belongs in the shell rather than on the protocol page. Adding a second per-page effect
# would leave the same hole open for the third page and for whatever a later setting is added
# to: the rule this file states is about the settings, not about the page that happens to host
# the control for one of them.

@analysis
Feature: Settings are written wherever they are changed

  As a researcher who sets up the protocol before the plate exists
  I want a setting to be saved from whichever page I set it on
  So that what comes back after a reload is what I actually chose

  Acceptance criteria:
    AC1  Changing a setting on any page writes it, without visiting another page first.
    AC2  What is stored matches what is on screen, so a reload restores the last choice.
    AC3  Starting over clears the procedure like every other setting.
    AC4  Nothing an instrument produced is written, whichever page did the writing.

  AC4 is the promise analysis-workflow.feature AC1 already makes, restated here because this
  contract widens who writes. A rule about what may be stored is worth re-checking whenever the
  set of callers grows, and it is cheaper to state it twice than to discover it was only ever
  true of the one page that used to do the writing.

  Background:
    Given a fresh session with nothing stored

  # AC1 — the defect, at the point where it starts: no analysis page in this scenario at all
  Scenario: Choosing a procedure writes it without visiting the analysis page
    When the procedure is set to "test_tube_enhanced" on the protocol page
    Then the stored procedure is "test_tube_enhanced"

  # AC2 — the disagreement measured on the shipped build, asserted as the equality it broke
  Scenario: A second choice replaces the first rather than leaving the old one stored
    Given the procedure set to "test_tube_enhanced" on the protocol page
    And the analysis page visited
    When the procedure is set to "microplate_reduced_sample" on the protocol page
    Then the stored procedure is "microplate_reduced_sample"
    And what is stored agrees with what the protocol page shows

  # AC2 — the whole point, from the researcher's side rather than the store's
  Scenario: The procedure chosen last is the one that comes back
    Given the procedure set to "test_tube_enhanced" on the protocol page
    When the page is reloaded from what was stored
    Then the protocol page shows "Test tube, enhanced"

  # AC2 — a setting is not restored until the thing it decides is restored with it.
  #
  # Asserted on the working range rather than on the select, because the select is the input and
  # the range is the consequence: the enhanced protocol is judged over 5-250 ug/mL where the
  # microplate standard is judged over 20-2000. A procedure that came back into the control but
  # not into the numbers would leave every sample flagged against the wrong range.
  Scenario: The restored procedure is the one the working range is taken from
    Given the procedure set to "test_tube_enhanced" on the protocol page
    When the page is reloaded from what was stored
    Then the working range shown is 5 to 250 ug/mL

  # AC3 — the procedure joins the settings that starting over clears.
  #
  # Started over from the button on the analysis page, which is where that button lives and what
  # session-continuity.feature already holds to its promise. The procedure was chosen two pages
  # away, which is the point: "start over" means the session, not the page it is pressed on.
  Scenario: Starting over restores the default procedure
    Given the procedure set to "test_tube_enhanced" on the protocol page
    And the analysis page shown ready to start over
    When the session is started over
    Then the stored procedure is "microplate_standard"
    And the protocol page shows "Microplate, standard"

  # AC4, negative — widening who writes must not widen what is written
  @negative
  Scenario: Setting up the protocol writes no assay value
    Given the workbook's plate analysed with the default layout
    When the procedure is set to "test_tube_enhanced" on the protocol page
    Then no assay value has been written to storage that outlives the tab

  # AC1, negative — writing must be caused by the setting changing, not by a page appearing.
  #
  # This is the defect's own shape, inverted. The old bug was a write that happened because the
  # analysis page mounted; the cheap wrong fix is a write that happens because anything rendered.
  # Both couple the store to navigation instead of to a choice, and both leave the store saying
  # something the person never did.
  #
  # Moving between pages is the trigger that matters here, and it took a mutation to learn why:
  # a version of the fix that wrote on every render survived a scenario about typing into the
  # reagent calculator. Signals subscribe per component, so those keystrokes re-render the
  # protocol page and never the shell — the scenario was aimed at a render that cannot happen.
  # Navigation is the one render the shell actually gets.
  @negative
  Scenario: Moving between pages writes nothing on its own
    Given the procedure set to "test_tube_enhanced" on the protocol page
    When every page is visited without changing a setting
    Then the session was written once for the procedure and not again

  # AC1, negative — the reagent calculator's inputs are not settings and are not stored.
  #
  # Kept alongside the scenario above rather than in place of it, and deliberately not credited
  # with more than it does: it holds the boundary between state/planning.ts and the session, and
  # the mutation above proved it does not by itself catch an over-eager writer.
  @negative
  Scenario: Typing into the reagent calculator writes nothing
    Given the procedure set to "test_tube_enhanced" on the protocol page
    When the number of unknowns is changed on the protocol page
    Then the session was written once for the procedure and not again
