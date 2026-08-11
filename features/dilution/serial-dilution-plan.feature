# Ported from BCA_quarto features/F02-dilution-planner.feature.md (specdoc §3.1).
#
# Replaces 20240905_BCA_Serial-Dilutions_preparation.xlsx. The nine golden rows below are the
# workbook's own verified output and are the contract: this app is only useful if a result
# computed today can be reconciled with one computed in the spreadsheet last year.
#
# The workbook's leftover column hard-codes which row draws from which (I7 = H7 - F9 assumes A
# feeds C). Change the source graph and those references keep computing, silently wrong. The
# graph-derived leftover is the fix, and "Leftover follows the graph" is the scenario that
# would have caught the original.

@dilution
Feature: Planning the BSA serial dilution series

  As a researcher preparing BSA standards before running the assay
  I want a pipetting scheme computed from the series I intend to make
  So that I can prepare the standards without re-deriving the workbook's arithmetic

  Acceptance criteria:
    AC1  The reference inputs reproduce all nine workbook rows to a tolerance of 1e-12.
    AC2  Leftover volume is derived from the actual source graph, not from row position.
    AC3  Vials are returned in an order where every source precedes the vials drawing from it.
    AC4  The volume to prepare is derived as volume per well times replicate count.
    AC5  The overage factor is an input with a default of 2.1, never a hidden constant.
    AC6  A blank vial has no source, no dilution factor, and draws no source volume.

  Background:
    Given the reference dilution inputs

  # AC1 — the golden fixture, in full
  Scenario: The reference series reproduces the workbook's nine rows
    When the dilution plan is built
    Then the plan is:
      | vial | conc | source | factor  | from_source | diluent | total | leftover |
      | A    | 2000 | Stock  | 1       | 105         | 0       | 105   | 52.5     |
      | B    | 1500 | Stock  | 1.33333 | 78.75       | 26.25   | 105   | 52.5     |
      | C    | 1000 | A      | 2       | 52.5        | 52.5    | 105   | 52.5     |
      | D    | 750  | B      | 2       | 52.5        | 52.5    | 105   | 105      |
      | E    | 500  | C      | 2       | 52.5        | 52.5    | 105   | 52.5     |
      | F    | 250  | E      | 2       | 52.5        | 52.5    | 105   | 52.5     |
      | G    | 125  | F      | 2       | 52.5        | 52.5    | 105   | 84       |
      | H    | 25   | G      | 5       | 21          | 84      | 105   | 105      |
      | I    | 0    |        |         | 0           | 50      | 50    | 50       |

  # AC4
  Scenario: The volume to prepare is the well volume times the replicate count
    When the dilution plan is built
    Then the volume to prepare is 50 uL

  # AC4 — scaling
  Scenario: Raising the replicate count scales every prepared volume
    Given the replicate count is 3
    When the dilution plan is built
    Then the volume to prepare is 75 uL
    And every vial's total volume is 1.5 times its reference value

  # AC2 — the defect the workbook's row-offset formula hides
  Scenario: Leftover follows the source graph rather than row order
    Given vial "C" is sourced from "Stock" instead of "A"
    When the dilution plan is built
    Then vial "A" has 105 uL leftover
    And vial "C" draws 52.5 uL from its source

  # AC6
  Scenario: The blank vial has no source and draws no source volume
    When the dilution plan is built
    Then vial "I" has no dilution factor
    And vial "I" draws 0 uL from its source
    And vial "I" is made up of 50 uL of diluent

  # AC5
  Scenario: Removing the overage prepares exactly the volume needed
    Given the overage factor is 1.0
    When the dilution plan is built
    Then vial "A" draws 50 uL from its source

  # AC3
  Scenario: Vials are ordered with every source before the vials drawing from it
    Given the vials are declared with each child before its source
    When the dilution plan is built
    Then every vial appears after the vial it draws from

  # The manual's Table 1, offered as the starting preset
  Scenario: The manual's Table 1 preset carries the published concentrations
    Given the manual Table 1 preset
    When the dilution plan is built
    Then the vial concentrations are 2000, 1500, 1000, 750, 500, 250, 125, 25, 0 ug/mL

  # AC1 — a valid plan must be quiet, or the issue panel becomes noise to scroll past
  Scenario: A valid plan reports nothing at error severity
    When the dilution plan is built
    Then the plan reports no issues at error severity

  # Boundary: below the reliable range of a P2 pipette
  @negative
  Scenario: A transfer below one microlitre is flagged as unpipettable
    Given a vial requiring a 0.4 uL transfer from its source
    When the dilution plan is built
    Then that vial is flagged "VOLUME_BELOW_PIPETTABLE" at warn severity
    And the plan still reports every vial

  # State: a parent that cannot supply its children
  @negative
  Scenario: A source drawn on by more children than it holds is refused
    Given vial "A" has three children each drawing 60 uL from it
    When the dilution plan is built
    Then vial "A" is flagged "INSUFFICIENT_SOURCE_VOLUME" at error severity
    And vial "A" has a negative leftover recorded rather than a clipped zero
