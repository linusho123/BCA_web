# Ported from BCA_quarto features/F11-plate-mapping.feature.md, layout half (specdoc §5.7).
#
# The plate this assay is actually run on has the standard series in row A, its second read in
# row B, and one sample per row from C down. Making every user type that layout out is asking
# them to restate the obvious and giving them a chance to get it wrong. The default expresses
# it as the same region strings they would otherwise type, so one mapping implementation still
# does all the work and hand-written regions stay the escape hatch for an unusual plate.
#
# The default reports what it found rather than what it assumed. That distinction is the whole
# feature: a layout that assumes row B exists feeds nine phantom empty replicates to the curve
# on a single-read plate, and says nothing.

@plate
Feature: Laying out a plate without typing any regions

  As a researcher running the lab's usual plate layout
  I want the standards and samples found where they always are
  So that a routine plate needs a name per sample and nothing else

  Acceptance criteria:
    AC1  The standard series is row A, and row B joins it only if row B holds a reading.
    AC2  Samples take one row each from C down, in the order their names are given.
    AC3  A sample's replicate count is the run of readable wells its row actually holds.
    AC4  A blank name holds its row open rather than sliding the samples below it up.
    AC5  Wells chosen by clicking collapse to the region string they describe.
    AC6  A region built from clicked wells parses back to those same wells.

  # AC1, AC2, AC3 — the ordinary case, which should need nothing said about it
  Scenario: A two-read plate maps its standards and samples with no regions typed
    Given a plate with the standard series in rows A and B
    And rows C and D each holding three replicates
    When the layout is derived for the names "MCF7" and "RPMI8226"
    Then the standard regions are "A1:A9" and "B1:B9"
    And the sample assignments are "MCF7=C1:C3" and "RPMI8226=D1:D3"
    And the layout reports no issues

  # AC1 — presence of data is the signal, so a single read is not padded out to two
  Scenario: A single-read plate leaves the empty second row out of the standards
    Given a plate with the standard series in row A and row B empty
    And rows C and D each holding three replicates
    When the layout is derived for the names "MCF7" and "RPMI8226"
    Then the standard regions are "A1:A9" alone
    And the layout reports no issues

  # AC3 — the row says how many replicates it holds; no setting is consulted
  Scenario: Each sample's replicate count is read off its own row
    Given a plate with the standard series in row A
    And row C holding two readings and row D holding five
    When the layout is derived for the names "MCF7" and "RPMI8226"
    Then the sample assignments are "MCF7=C1:C2" and "RPMI8226=D1:D5"

  # AC3 — a gap ends the run, so a stray note further along the row is not a replicate
  Scenario: A gap in a row ends that sample's run of replicates
    Given a plate with the standard series in row A
    And row C holding three readings, a gap, then a stray reading in C7
    When the layout is derived for the name "MCF7"
    Then the sample assignments are "MCF7=C1:C3" alone

  # AC4 — position is the row, so a blank entry skips one
  Scenario: A blank name skips its row instead of shifting the samples below it
    Given a plate with the standard series in row A
    And rows C and D each holding three replicates
    When the layout is derived for the names "" and "RPMI8226"
    Then the sample assignments are "RPMI8226=D1:D3" alone

  # AC5 — the description of which wells are the sample's, not the click order
  Scenario Outline: Clicked wells collapse to the region that describes them
    Given the wells "<clicked>" have been selected
    When the region is built from the selection
    Then the region reads "<region>"

    Examples:
      | clicked              | region             |
      | C1,C2,C3             | C1:C3              |
      | C3,C1,C2             | C1:C3              |
      | D1,C5,C1,C2,C6       | C1:C2, C5:C6, D1   |
      | C1                   | C1                 |

  # AC6 — the highlight the user sees and the text they read back are one fact
  Scenario: A region built from clicked wells parses back to the same wells
    Given the wells "c2, C1 ,C1,C3" have been selected
    When the region is built from the selection
    Then parsing that region returns the wells "C1,C2,C3"
    And the region reports no issues

  # Clearing: the readings go, the layout stays
  Scenario: Clearing the plate empties every reading and keeps the sample layout
    Given a plate with the standard series in rows A and B
    And two samples whose wells have been selected
    When the plate is cleared
    Then every well is empty
    And the pasted text is empty
    And both sample names and their wells survive

  # AC2 — a name over a row with nothing in it
  @negative
  Scenario: A name over an empty row is reported and left unmapped
    Given a plate with the standard series in row A and row C empty
    And row D holding three replicates
    When the layout is derived for the names "Ghost" and "RPMI8226"
    Then the layout is flagged "UNREADABLE_WELL_IN_REGION" at warn severity naming "Ghost"
    And the sample assignments are "RPMI8226=D1:D3" alone

  # Boundary: one more name than the plate has rows left
  @negative
  Scenario: More names than rows below the standards is refused naming the overflow
    Given a plate with the standard series in rows A and B
    And rows C through H each holding three replicates
    When the layout is derived for seven sample names
    Then the layout is flagged "REGION_OUT_OF_BOUNDS" at error severity naming the 7th name
    And the first six samples are still assigned

  # Empty
  @negative
  Scenario: A plate with no readable well produces no layout at all
    Given a plate whose wells are all empty
    When the layout is derived for the names "MCF7" and "RPMI8226"
    Then no standard regions are produced
    And no sample assignments are produced
