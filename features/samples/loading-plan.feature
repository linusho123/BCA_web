# Ported from BCA_quarto features/F07-loading-plan.feature.md (specdoc §3.3, §6.5).
#
# This is where the workbook's worst defect lives. K29 = $M$26 - J29 - L29 prints -750.66 uL
# of diluent for the reference dataset, with no warning and no formatting to distinguish it
# from a volume someone could pipette. The physical meaning is that the sample is too dilute to
# deliver 400 ug in the requested volume; the three ways out are to concentrate the sample,
# lower the target mass, or raise the final volume. The workbook says none of that.
#
# So the contract here is not "compute the diluent volume". It is "never print a volume nobody
# can pipette without saying why and what to do instead".

@loading
Feature: Planning SDS-PAGE loading volumes

  As a researcher taking quantified samples to a gel
  I want the pipetting volumes for a fixed protein mass in a fixed well volume
  So that each lane is loaded with the same mass without arithmetic at the bench

  Acceptance criteria:
    AC1  The workbook's protein volumes reproduce to a relative tolerance of 1e-9.
    AC2  Loading dye is the configured fraction of the final volume, a quarter by default.
    AC3  A plan that does not fit is never returned as a negative diluent volume.
    AC4  An infeasible plan states the volume required against the volume available.
    AC5  A feasible plan's three volumes sum to the final volume.
    AC6  The no-dye variant matches the workbook's second loading table.

  # AC1 — the numbers in the workbook's own J column
  Scenario Outline: The workbook's protein volumes reproduce exactly
    Given the sample "<name>" at <conc> ug/uL
    And a target of 400 ug in 1000 uL with dye
    When the loading plan is built
    Then "<name>" needs <protein> uL of sample

    Examples:
      | name     | conc                | protein            |
      | MCF7     | 0.532863708973195   | 750.6609912894659  |
      | RPMI8226 | 0.40137678659490655 | 996.5698400084705  |

  # AC2, AC5 — an ordinary, feasible lane
  Scenario: A feasible plan's volumes sum to the final volume
    Given the sample "Lysate" at 2 ug/uL
    And a target of 10 ug in 30 uL with dye
    When the loading plan is built
    Then "Lysate" needs 5 uL of sample, 17.5 uL of diluent and 7.5 uL of dye
    And those three volumes sum to 30 uL
    And the plan reports no issues

  # AC2 — a quarter by default, because 4x dye is what the lab stocks; 0.2 is a 5x dye
  Scenario Outline: Dye volume follows the configured fraction of the final volume
    Given the sample "Lysate" at 2 ug/uL
    And a target of 10 ug in <volume> uL with a dye fraction of <fraction>
    When the loading plan is built
    Then "Lysate" needs <dye> uL of dye

    Examples:
      | volume | fraction | dye |
      | 40     | 0.25     | 10  |
      | 25     | 0.2      | 5   |
      | 30     | 0.25     | 7.5 |

  # AC6 — the workbook's rows 56 to 80
  Scenario: The no-dye variant fills the rest of the volume with diluent
    Given the sample "Lysate" at 2 ug/uL
    And a target of 10 ug in 30 uL without dye
    When the loading plan is built
    Then "Lysate" needs 5 uL of sample, 25 uL of diluent and 0 uL of dye

  # AC5 — boundary: exactly full is feasible
  Scenario: A lane that is exactly full is feasible with no diluent
    Given the sample "Lysate" at 2 ug/uL
    And a target of 45 ug in 30 uL with dye
    When the loading plan is built
    Then "Lysate" needs 22.5 uL of sample, 0 uL of diluent and 7.5 uL of dye
    And the plan reports no issues

  # AC1 — order is how a researcher matches rows to tubes
  Scenario: Loading rows keep the order and names of the results they came from
    Given four samples named in a deliberate order
    And a target of 10 ug in 30 uL with dye
    When the loading plan is built
    Then the loading rows appear in that order with those names

  # AC3, AC4 — the reference defect, in the state the workbook is actually in
  @negative
  Scenario: The workbook's own infeasible lane is refused with the numbers that explain it
    Given the sample "MCF7" at 0.532863708973195 ug/uL
    And a target of 400 ug in 30 uL with dye
    When the loading plan is built
    Then "MCF7" is not feasible
    And "MCF7" is flagged "INSUFFICIENT_VOLUME" at error severity
    And the message states 758.16 uL required against 30 uL available
    And no negative diluent volume is reported

  # AC3 — the literal state of the reference sheet, where M26 is blank
  @negative
  Scenario: A blank final volume is refused rather than printing minus 750 microlitres
    Given the sample "MCF7" at 0.532863708973195 ug/uL
    And a target of 400 ug in 0 uL with dye
    When the loading plan is built
    Then "MCF7" is flagged "NON_POSITIVE_VOLUME" at error severity
    And no negative diluent volume is reported

  # Malformed — the division in the protein volume
  @negative
  Scenario Outline: A sample that cannot supply protein is refused, not divided by
    Given the sample "Odd" at <conc> ug/uL
    And a target of 10 ug in 30 uL with dye
    When the loading plan is built
    Then "Odd" is flagged "ZERO_CONCENTRATION_DIVISION" at error severity
    And "Odd" needs no stated volume of sample

    Examples:
      | conc |
      | 0    |
      | -0.5 |

  # Malformed — the targets are typed inputs
  @negative
  Scenario Outline: A target that cannot describe a lane is refused by name
    Given the sample "Lysate" at 2 ug/uL
    And a target of <mass> ug in <volume> uL with a dye fraction of <fraction>
    When the loading plan is built
    Then the plan is flagged "<code>" at error severity

    Examples:
      | mass | volume | fraction | code                 |
      | 0    | 30     | 0.25     | NON_POSITIVE_VOLUME  |
      | -10  | 30     | 0.25     | NON_POSITIVE_VOLUME  |
      | 10   | -5     | 0.25     | NON_POSITIVE_VOLUME  |
      | 10   | 30     | 1.5      | DYE_FRACTION_INVALID |

  # Boundary — below what a P2 can deliver reliably
  @negative
  Scenario: A protein volume below half a microlitre is flagged as unpipettable
    Given the sample "Concentrated" at 100 ug/uL
    And a target of 10 ug in 30 uL with dye
    When the loading plan is built
    Then "Concentrated" needs 0.1 uL of sample
    And "Concentrated" is flagged "PROTEIN_VOLUME_UNPIPETTABLE" at warn severity

  # State — the sample upstream had nothing readable
  @negative
  Scenario: A sample with no concentration yields a row of absences, not an exception
    Given the sample "Ghost" with no concentration
    And a target of 10 ug in 30 uL with dye
    When the loading plan is built
    Then "Ghost" appears in the loading rows
    And "Ghost" needs no stated volume of sample
    And "Ghost" carries the issue that left it without a concentration
