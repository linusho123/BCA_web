# Scoped 2026-08-11. Not yet implemented — see spec/OUT-OF-SCOPE.md.
#
# Replaces the "Sample names" text field as the way a layout is expressed. The regions the
# domain already speaks — "A1:A9", "C1,C2,C5" — are unchanged: parseRegion already accepts a
# comma-separated mix of wells and spans, so painting produces exactly the strings a user
# used to type, and nothing below state/ needs to know a grid exists.
#
# This feature carries claims about colour, focus and the keyboard that curve-plot-presentation
# already makes about the chart, and for a stronger reason: the chart enhances a table that
# holds the same numbers, while painting is the only way to assign a sample. It gates, so it
# earns the @a11y tag rather than borrowing the chart's exemption.

@plate
Feature: Painting which wells hold which sample

  As a researcher whose plate layout is not the one the app assumes
  I want to say which wells hold what by marking them on the grid
  So that the layout I describe is the layout I can see

  Acceptance criteria:
    AC1  Standards are painted automatically on every new plate; samples are not.
    AC2  Painting a well assigns it to the selected name, and painting over reassigns it.
    AC3  A well's assignment is readable as text, never carried by colour alone.
    AC4  Every well can be reached and painted with the keyboard alone.
    AC5  A well nobody assigned is left out of the calculation and reported on by nothing.
    AC7  Any new plate data clears sample painting; standards are re-derived from the plate.

  The palette holds the standards, one entry per sample name, and an erase entry. Sample names
  come from the existing sample-names field, which the grid does not replace.

  The empty-well-inside-an-assignment rule is specified in spec/plate-empty-wells.feature and
  is not built here. The domain half of it is done and passing in the node suite; what is not
  proven is the path from a painted region to that warning on the page.

  Background:
    Given the workbook's plate pasted into the grid

  # AC1 — the ordinary plate, which should cost nothing to lay out
  Scenario: Standards are already painted when a plate arrives
    Then wells "A1:A9" are assigned to the standards
    And wells "B1:B9" are assigned to the standards
    And no well is assigned to a sample

  # AC1 — the standards' concentrations, which painting alone does not state
  Scenario: Painted standards take the lab series in plate order
    Then the standards carry the lab series in plate order
    And the standards are read as 2 replicates of 9

  # AC2 — the smallest useful act
  Scenario: Painting wells assigns them to the selected sample
    Given "MCF7" is the selected name
    When wells "C1", "C2" and "C3" are painted
    Then wells "C1:C3" are assigned to "MCF7"
    And the curve is fitted from the standards on the plate

  # AC2 — the correction path, which is the whole reason a paint tool beats a text field
  Scenario: Painting over an assigned well moves it to the new sample
    Given wells "C1:C3" assigned to "MCF7"
    And "RPMI8226" is the selected name
    When wells "C3" is painted
    Then wells "C1:C2" are assigned to "MCF7"
    And wells "C3" are assigned to "RPMI8226"

  # AC2 — taking a well back out again
  Scenario: Erasing a well leaves it holding its number and nothing else
    Given wells "C1:C3" assigned to "MCF7"
    And the erase entry is the selected name
    When wells "C3" is painted
    Then wells "C1:C2" are assigned to "MCF7"
    And well "C3" is assigned to nothing
    And well "C3" holds 0.430

  # AC3 — the claim curve-plot-presentation makes about the chart, made here about the grid
  Scenario: A well states its assignment in text, not only in colour
    Given wells "C1:C3" assigned to "MCF7"
    Then well "C1" shows the text "MCF7"
    And well "A1" shows the text for the standards
    And the assignment of well "C1" is legible with every colour removed

  # AC4 — a grid that only a mouse can paint has a keyboard-shaped hole
  @a11y
  Scenario: Every well can be reached and painted from the keyboard
    Given "MCF7" is the selected name
    And the grid focused with the cursor on well "C1"
    When the paint key is pressed
    Then wells "C1" are assigned to "MCF7"
    And every well in the grid can be reached in turn from the keyboard

  # AC5 — the ruling that an unassigned well is not a problem to be reported
  Scenario: Wells nobody assigned are left out without comment
    Given wells "C1:C3" assigned to "MCF7"
    Then no issue is raised about a well outside an assignment
    And "MCF7" reports a concentration from 3 wells

  # AC7 — the safety rule, applied to the path that makes it matter
  Scenario: A newly pasted plate clears the sample painting
    Given wells "C1:C3" assigned to "MCF7"
    When a different plate is pasted into the paste box
    Then no well is assigned to a sample
    And wells "A1:A9" are assigned to the standards
