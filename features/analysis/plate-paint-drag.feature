# Painting a run of wells in one gesture.
#
# Ruled 2026-08-12, and it is a change to a fence rather than a gap in one. spec/OUT-OF-SCOPE.md
# "Selecting wells" rejected *drag a rectangle* — a skipped bad well needs a second drag — and
# the option that beat it was described as "painting across a row". A row is what a drag along
# one is. What shipped was click-per-well, so the gesture the winning argument was named after
# was the one thing the grid did not do: press on C1, drag to C3, release, and nothing happened
# at all. Not a rectangle, not the first well, nothing. See the sanctioned-changes table.
#
# This is its own feature file because plate-layout-painting.feature is at the 12-scenario cap
# and because the subject is different: that file is about what a painted well means, this one
# is about a gesture. The palette still decides *what* is painted; the drag only decides *where*,
# which is why erase and the standards come along for free rather than needing their own rules.
#
# Wells entered, not a rectangle between the ends. Dragging C1 to C3 paints C1, C2 and C3
# because the pointer went over all three. It is also what keeps the original objection answered:
# a bad well you steer around is a well you did not enter, so it stays out without a second drag.
#
# Touch is deliberately not this. A finger dragging across the grid scrolls it — the plate is
# wider than a phone — and there is no hover, so there is nothing between press and release to
# paint with. Tap still paints one well. This gesture is for a mouse, a trackpad or a pen.

@plate
Feature: Painting a run of wells by dragging across them

  As a researcher laying out a plate a row at a time
  I want to press on the first well and drag across the rest
  So that a row of replicates costs one gesture rather than one click per well

  Acceptance criteria:
    AC1  A drag paints every well the pointer enters, the one it started on included.
    AC2  A drag paints with whatever the palette holds, erase included.
    AC3  A drag over wells that already hold something moves them, exactly as a click does.
    AC4  A drag paints nothing while "Type values" is selected.
    AC5  Only a gesture that began on a well paints, and it stops painting once let go.

  AC5 is the one that is not about painting, and it is two claims rather than one because a drag
  can go wrong at either end. A press that began somewhere else — on the panel, on a scrollbar,
  on the page margin — must not paint the wells it later sweeps over, or selecting a paragraph
  relabels a row. And a press that began on a well must stop painting when it is let go, even
  when the release lands somewhere the page never hears about: off the window, or in another
  application entirely, where no release event is delivered at all. Each half needs its own
  scenario because each is caught by a different thing, and a scenario that both halves satisfy
  would let either one be deleted with the suite still green.

  Background:
    Given the workbook's plate pasted into the grid

  # AC1 — the gesture, and the whole reason for the ruling
  Scenario: A drag across a row paints every well it crosses
    Given "MCF7" is the selected name
    When wells "C1:C3" are painted with one drag
    Then wells "C1:C3" are assigned to "MCF7"
    And "MCF7" reports a concentration from 3 wells

  # AC1 — the well under the pointer when it went down is painted like any other
  Scenario: The well a drag starts on is painted with the rest
    Given "MCF7" is the selected name
    When wells "C1:C2" are painted with one drag
    Then well "C1" shows the text "MCF7"
    And well "C2" shows the text "MCF7"

  # AC1 — a well steered around is a well not entered, which is the objection the fence raised
  Scenario: A well the drag went around is left out of it
    Given "MCF7" is the selected name
    When wells "C1", "C2" and "C4" are painted with one drag
    Then wells "C1:C2" are assigned to "MCF7"
    And well "C3" is assigned to nothing
    And well "C4" shows the text "MCF7"

  # AC3 — the correction path, dragged rather than clicked
  Scenario: A drag over another sample's wells moves them across
    Given wells "C1:C3" assigned to "MCF7"
    And "RPMI8226" is the selected name
    When wells "C2:C3" are painted with one drag
    Then wells "C1" are assigned to "MCF7"
    And wells "C2:C3" are assigned to "RPMI8226"

  # AC2 — the palette decides what a drag means, so erase is a drag like any other
  Scenario: Dragging with erase selected takes the wells back out
    Given wells "C1:C3" assigned to "MCF7"
    And the erase entry is the selected name
    When wells "C2:C3" are painted with one drag
    Then wells "C1" are assigned to "MCF7"
    And well "C2" is assigned to nothing
    And well "C3" holds 0.430

  # AC4, negative — a well is a text box first, and dragging in one selects text.
  #
  # This is the claim that "off by default" was for. A researcher correcting a typo drags across
  # the number to select it, and a grid that painted then would have changed three wells while
  # they were trying to retype one.
  #
  # Dragged across the standards rather than across empty wells, which is the difference between
  # a scenario and a decoration. Painting is a move, so an unarmed drag that reached the paint
  # path at all would take each well off whatever held it and put it nowhere — invisible on
  # unassigned wells, and on row A the loss of the standards the curve is fitted from. A first
  # version of this scenario dragged C1:C3 and passed with that guard deleted.
  @negative
  Scenario: A drag paints nothing while Type values is selected
    Given the palette left on typing values
    When wells "A1:A3" are painted with one drag
    Then wells "A1:A9" are assigned to the standards
    And no well is assigned to a sample
    And the standards are still read as 2 replicates of 9

  # AC5, negative — let go where the page is never told, so nothing but the pointer itself says so
  @negative
  Scenario: A pointer that comes back with no button held paints nothing
    Given "MCF7" is the selected name
    And a drag started on well "C1" and let go where the page never heard it
    When the pointer passes back over wells "C2:C3" with no button held
    Then well "C2" is assigned to nothing
    And well "C3" is assigned to nothing

  # AC5, negative — a press that began off the grid is somebody selecting text, not painting
  @negative
  Scenario: A drag that began outside the grid paints nothing it sweeps over
    Given "MCF7" is the selected name
    When a drag begun off the grid sweeps across wells "C1:C3"
    Then no well is assigned to a sample
    And wells "A1:A9" are assigned to the standards
