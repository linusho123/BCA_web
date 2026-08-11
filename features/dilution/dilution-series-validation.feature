# Ported from BCA_quarto features/F02-dilution-planner.feature.md, negative half
# (specdoc §6.1, §6.2).
#
# Split from serial-dilution-plan.feature because validating the definition of a series is a
# different capability from computing one, and because the combined file exceeded the
# twelve-scenario limit. Every code in specdoc §6.1 and §6.2 is provoked here.
#
# Validation returns issues as data. Nothing here throws: a researcher mid-edit types a series
# through many invalid intermediate states, and an exception at that boundary would blank the
# planner instead of annotating the row being typed.

@dilution
Feature: Validating a serial dilution series definition

  As a researcher editing a standard series
  I want an impossible series refused with the reason attached to the vial that caused it
  So that I find out at the bench-planning stage rather than at the plate reader

  Acceptance criteria:
    AC1  Every input and graph rule in specdoc §6.1 and §6.2 reports its own issue code.
    AC2  Validation never throws; a malformed series returns issues, not an exception.
    AC3  An error-severity issue suppresses the plan rows; a warning leaves them in place.
    AC4  Each issue names the vial it belongs to, so the planner can mark that row.
    AC5  A series that satisfies every rule reports nothing.

  # AC5 — the control case, without which the rest proves only that everything fails
  Scenario: A well-formed series reports no issues at all
    Given the reference dilution inputs
    When the dilution plan is built
    Then the plan reports no issues

  # AC1, AC3 — global inputs, specdoc §6.1
  @negative
  Scenario Outline: A non-physical global input is refused with its own code
    Given the reference dilution inputs
    And the <field> is <value>
    When the dilution plan is built
    Then the plan is flagged "<code>" at error severity
    And no vial rows are produced

    Examples:
      | field           | value | code                     |
      | stock strength  | 0     | NON_POSITIVE_STOCK       |
      | stock strength  | -2    | NON_POSITIVE_STOCK       |
      | well volume     | -5    | NON_POSITIVE_VOLUME      |
      | well volume     | 0     | NON_POSITIVE_VOLUME      |
      | replicate count | 0     | NON_POSITIVE_REPLICATES  |
      | overage factor  | 0.5   | OVERAGE_BELOW_ONE        |

  # AC1, AC4 — the source graph, specdoc §6.2
  @negative
  Scenario Outline: A broken source graph is refused with its own code
    Given the reference dilution inputs
    And the series has <defect>
    When the dilution plan is built
    Then the plan is flagged "<code>" at error severity
    And no vial rows are produced

    Examples:
      | defect                                  | code                   |
      | a vial sourced from missing vial "Z"    | UNKNOWN_SOURCE         |
      | vial "P" from "Q" and vial "Q" from "P" | CIRCULAR_SOURCE        |
      | a vial listing itself as its source     | SELF_SOURCE            |
      | two vials both named "A"                | DUPLICATE_VIAL_ID      |
      | a vial at -100 ug/mL                    | NEGATIVE_CONCENTRATION |
      | no vials at all                         | EMPTY_VIAL_LIST        |

  # AC1, AC4 — dilution cannot concentrate. The rows survive so the planner can mark the one
  # row that is wrong; blanking the table would hide which vial to fix.
  @negative
  Scenario: A vial stronger than the vial it is diluted from is refused
    Given the reference dilution inputs
    And a 1000 ug/mL vial sourced from a 500 ug/mL vial
    When the dilution plan is built
    Then that vial is flagged "CONCENTRATION_INCREASE" at error severity
    And the plan still reports every vial
    And that vial has no volumes computed

  # AC3 — a warning must leave the plan usable, or it may as well be an error
  @negative
  Scenario Outline: A questionable but workable series is warned about and still planned
    Given the reference dilution inputs
    And the series has <defect>
    When the dilution plan is built
    Then the plan is flagged "<code>" at warn severity
    And the plan still reports every vial

    Examples:
      | defect                                 | code                          |
      | a 0 ug/mL vial declaring a source      | BLANK_WITH_SOURCE             |
      | a 1000 ug/mL vial from another at 1000 | DILUTION_FACTOR_ONE_FROM_VIAL |

  # AC2 — malformed text from the editable table, not a typed value
  @negative
  Scenario: A vial concentration that is not a number is refused, not coerced
    Given the reference dilution inputs
    And a vial whose concentration was typed as "1e3 ug"
    When the dilution plan is built
    Then the plan is flagged "NON_NUMERIC_INPUT" at error severity
    And no vial rows are produced

  # AC2 — the property the whole panel depends on
  @negative
  Scenario: Hostile series definitions return issues rather than throwing
    Given the reference dilution inputs
    And a series of vials with punctuation, unicode and empty names
    When the dilution plan is built
    Then the plan reports issues at error severity
    And no exception escapes the planner
