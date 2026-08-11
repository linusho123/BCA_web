# Replaces BCA_quarto features/F10-site-interactivity.feature.md.
#
# F10 specified a Quarto site with Shinylive blocks: a purity constraint on the core so it
# could run under Pyodide, a generator that inlined that core into each .qmd, and a drift test
# to stop the inlined copies diverging from src/. None of that survives the port, because none
# of it was about the assay — it was the cost of running Python in a browser.
#
# What was load-bearing survives, and it is all here: the whole calculation runs client-side so
# no absorbance leaves the machine that pasted it, every stage returns its value paired with
# its issues so a failure degrades one panel instead of the page, and a stage whose input is
# broken does not silently compute from stale data.

@analysis
Feature: Carrying a plate through the analysis workflow

  As a researcher working through a plate from paste to loading volumes
  I want each stage to recompute from the one before it and say when it cannot
  So that I can correct a mistake at the stage that made it, without starting again

  Acceptance criteria:
    AC1  The whole calculation runs in the browser; no assay data is sent anywhere.
    AC2  Every stage returns its value together with its issues, never throwing across stages.
    AC3  Editing a stage recomputes the stages after it and nothing before it.
    AC4  A stage whose input failed reports that, rather than computing from stale values.
    AC5  Issues are shown grouped by severity, with the stage that raised them named.
    AC6  Nothing is required to be typed twice; the plate feeds standards, samples and export.
    AC7  The worked example loads a session that computes cleanly end to end.

  What a session looks like before a plate is in it — the empty page, and the one restored from
  a previous visit — is in session-continuity.feature.

  Background:
    Given the analysis page with the workbook's plate loaded

  # AC7 — the button is the first thing most people press, so it is the app's first impression.
  #
  # It carries the loading settings with it rather than inheriting whatever was left in the
  # session. The workbook pairs 400 ug with a 1000 uL lane and no dye — its second loading
  # table, rows 56 to 80 — and those three go together: 400 ug into the app's ordinary 30 uL
  # lane needs 750.7 uL of sample, so the example would open on two errors about a target it
  # set for itself. A demonstration that cannot run is not a demonstration.
  Scenario: The worked example loads a session that computes without complaint
    Given a session with no plate loaded
    When the worked example is loaded
    Then both samples report a loading volume
    And every lane in the loading plan is loadable
    And the issue panel reports nothing at error severity

  # AC6 — the shape of the ordinary session, end to end
  Scenario: A pasted plate carries through to loading volumes without retyping
    When the default layout is applied with the names "MCF7" and "RPMI8226"
    Then the curve is fitted from the standards on the plate
    And both samples report a concentration
    And both samples report a loading volume

  # AC3 — the reactive contract, in the direction it runs
  Scenario: Correcting one well recomputes the curve and everything after it
    Given the default layout applied with the names "MCF7" and "RPMI8226"
    When well "A3" is corrected to 0.2705
    Then the curve coefficients change
    And both samples' concentrations change

  # AC3 — and the direction it does not run
  Scenario: Changing the loading target leaves the curve and the concentrations alone
    Given the default layout applied with the names "MCF7" and "RPMI8226"
    When the loading target is changed to 20 ug in 30 uL
    Then the curve coefficients are unchanged
    And both samples' concentrations are unchanged
    And both samples' loading volumes change

  # AC3 — the switch that changes the numbers
  Scenario: Turning blank subtraction off reproduces the legacy workbook exactly
    Given the default layout applied with the names "MCF7" and "RPMI8226"
    When blank subtraction is turned off
    Then the curve coefficients are the workbook's four values
    And "MCF7" is 266.4318544865975 ug/mL in the well

  # AC1 — the reason this app can hold unpublished data at all
  Scenario: Running an analysis sends nothing over the network
    When the default layout is applied with the names "MCF7" and "RPMI8226"
    Then no network request is made
    And no assay value is written to persistent storage

  # AC5
  Scenario: Issues are grouped by severity and name the stage that raised them
    Given a plate whose well "A3" reads "OVRFLW"
    When the default layout is applied with the names "MCF7" and "RPMI8226"
    Then the issue panel groups issues by severity
    And each issue names the stage it came from

  # AC4 — the whole point of returning issues rather than throwing
  @negative
  Scenario: A plate that will not parse leaves the later stages empty, not stale
    Given a previously analysed session
    When the plate is replaced with text that will not parse
    Then the plate reports an issue at error severity
    And the curve reports that its input is unavailable
    And no sample carries a concentration from the previous plate

  # AC4 — a curve that cannot be fitted must not produce concentrations
  @negative
  Scenario: Samples report the curve's failure rather than a concentration
    Given a plate whose standards row holds a single repeated absorbance
    When the default layout is applied with the names "MCF7" and "RPMI8226"
    Then the curve is flagged "SINGULAR_DESIGN" at error severity
    And both samples are flagged "CURVE_UNAVAILABLE" at error severity

  # AC2 — the property every panel depends on
  @negative
  Scenario: A stage that fails degrades its own panel and leaves the others rendered
    Given the default layout applied with the names "MCF7" and "RPMI8226"
    When the loading target is set to 0 uL
    Then the loading panel reports an issue at error severity
    And the curve panel still shows its coefficients
    And the samples panel still shows its concentrations

  # AC1 — restated as a refusal, because it is a promise made to the person pasting
  @negative
  Scenario: No assay value reaches a request even when an export is downloaded
    Given the default layout applied with the names "MCF7" and "RPMI8226"
    When the results are exported
    Then the download is produced in the browser
    And no network request is made
