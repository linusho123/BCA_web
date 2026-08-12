# Which end of the row the standard series starts at.
#
# Scoped 2026-08-12, after the series direction was corrected once already. That fix
# (default-plate-layout.feature AC7) settled which direction is *default* — column 1 holds the
# most concentrated tube, the way the series is pipetted at this bench. It did not give anyone a
# way to say otherwise, and a plate pipetted the other way is not a mistake in the app: it is a
# different plate, and the second-commonest one.
#
# This is its own feature file rather than scenarios added to the layout or workflow features
# because it is its own subject, and because both of those are at the 12-scenario cap. The
# domain half of the question — what descending *means* — stays in default-plate-layout.feature
# AC7, which this file does not restate.
#
# The reason it is worth a feature at all is the failure mode. Reading a series backwards does
# not throw, does not blank a panel, and does not have to look wrong: the fit is a polynomial
# through nine points and a polynomial does not care what order they arrive in. Read the
# workbook's own plate with the series reversed and it still fits — r-squared 0.9502 against the
# right direction's 0.9986, low but not the kind of number that stops anyone — and still plots a
# smooth curve, while every tube wears the wrong absorbance and a sample reading 0.43 comes back
# as 767 ug/mL where the truth is 266.4. So the toggle has to be checkable from the screen
# without re-deriving the assay, which is what AC3 and AC5 are for.

@analysis @plate
Feature: Reading the standard series from either end of the row

  As a researcher whose plate was pipetted left to right for once
  I want to tell the app which end of the row the concentrated standard is at
  So that my tubes are read against the concentrations they actually held

  Acceptance criteria:
    AC1  The default is unchanged: column 1 is the most concentrated standard.
    AC2  Switching the direction re-pairs the series and refits everything after it.
    AC3  The direction is legible on the page, not only in the numbers.
    AC4  The direction is a setting, so it survives a reload and a start-over resets it.
    AC5  Switching the direction on a plate pipetted the other way reproduces the same curve.

  AC5 is the property that makes this a toggle rather than two separate features. Reversing the
  series and reversing the plate are inverses, so a plate pipetted 0 -> 2000 and read ascending
  must fit the identical curve to the workbook's own plate read descending — the same four
  coefficients, not merely a similar shape. Anything less means one of the two directions is
  doing something other than reading the same series from the other end.

  Background:
    Given the analysis page with the workbook's plate loaded

  # AC1 — the default is the bench's own direction and stays it
  Scenario: The series runs down from column 1 unless told otherwise
    When the default layout is applied with the names "MCF7" and "RPMI8226"
    Then the standards table reads tube "A" first at 2000 ug/mL
    And the standards table reads tube "I" last at 0 ug/mL

  # AC2 — the whole point: the pairing changes, and everything fitted from it changes with it
  Scenario: Switching to ascending re-pairs the series with the wells
    Given the default layout applied with the names "MCF7" and "RPMI8226"
    When the standards direction is switched to ascending
    Then the standards table reads tube "I" first at 0 ug/mL
    And the standards table reads tube "A" last at 2000 ug/mL
    And the curve coefficients change

  # AC5 — the inverse property, and the reason a single setting can serve both benches.
  #
  # Same nine absorbances, same nine concentrations, pipetted in opposite directions and read
  # with opposite settings. The coefficients are asserted equal to the workbook's own four
  # rather than merely "unchanged", so this cannot pass by both sides being wrong together.
  #
  # Blank subtraction is off for the same reason it is off in the workflow feature's legacy
  # scenario: the workbook does not subtract, so those four values are only reachable with it
  # off. The inverse property itself holds either way — it is a fact about the pairing, not
  # about the blank — and the descending half of it is what every other scenario here rests on.
  Scenario: A plate pipetted the other way fits the same curve when read ascending
    Given a plate whose standard row runs from the blank up to 2000 ug/mL
    And the default layout applied with the names "MCF7" and "RPMI8226"
    And blank subtraction turned off
    When the standards direction is switched to ascending
    Then the curve coefficients are the workbook's four values
    And "MCF7" is 266.4318544865975 ug/mL in the well

  # AC3 — a reader must be able to check the direction without re-deriving the assay.
  #
  # The tube letters in the standards table are what make the pairing visible at all: the
  # concentrations alone are a column of numbers that looks equally plausible either way up.
  Scenario: The standards table names the tube each well was read against
    Given the default layout applied with the names "MCF7" and "RPMI8226"
    When the standards direction is switched to ascending
    Then the standards table lists the tubes in the order "I", "H", "G"
    And the page reports the standards direction as "Ascending"

  # AC4 — a direction left behind from the last plate is exactly as quiet as a dilution factor.
  #
  # The reload carries the plate the tab was holding, because that is what a reload does here:
  # the settings come back from local storage and the plate from the tab's own. Without the
  # plate there is no curve panel and so no control to read the direction off, and this
  # scenario is about a reader seeing which way the last plate was read.
  Scenario: The direction survives a reload
    Given the default layout applied with the names "MCF7" and "RPMI8226"
    And the standards direction switched to ascending
    When the page is reloaded with the plate the tab was holding
    Then the page reports the standards direction as "Ascending"

  # AC4 — and starting over puts the bench's own direction back.
  #
  # Asserted on the setting rather than on the page, because starting over takes the plate with
  # it: what is on screen afterwards is the empty state, which has no curve panel to carry the
  # control. That the control tells the truth about the setting is the scenario above this one.
  Scenario: Starting over restores the default direction
    Given the default layout applied with the names "MCF7" and "RPMI8226"
    And the standards direction switched to ascending
    When the session is started over
    Then the standards direction setting is back to "Descending"

  # AC2, negative — the direction is a re-pairing, so it must not quietly drop a standard.
  #
  # Reversing a list is the kind of operation that loses an element off one end when it is
  # written by hand, and a curve fitted from eight of nine standards still fits.
  @negative
  Scenario: Switching direction keeps every standard rather than dropping one off the end
    Given the default layout applied with the names "MCF7" and "RPMI8226"
    When the standards direction is switched to ascending
    Then the standards table still holds nine levels
    And every absorbance on the plate row is still accounted for

  # AC2, negative — the direction changes the pairing and nothing else about the plate
  @negative
  Scenario: Switching direction leaves the plate and the sample wells alone
    Given the default layout applied with the names "MCF7" and "RPMI8226"
    When the standards direction is switched to ascending
    Then the plate row "A" is unchanged
    And both samples' mean absorbances are unchanged
