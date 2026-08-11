# Ported from BCA_quarto features/F08-working-reagent.feature.md (specdoc §2.3).
#
# Neither reference workbook computes this. Researchers work it out by hand at the bench, which
# is where a 50:1 ratio becomes a 51:1 one and a plate's worth of reagent goes in the bin.
#
# The manual's own worked example — 9 standards, 3 unknowns, 2 replicates, test tube, 48 mL —
# is the fixture. If this app disagrees with the printed manual, the app is wrong.

@reagent
Feature: Calculating the working reagent

  As a researcher about to run a plate
  I want the volume of working reagent and its A to B split
  So that I mix once, in the right ratio, with nothing left over and nothing short

  Acceptance criteria:
    AC1  The Pierce manual's worked example reproduces exactly at 48 mL.
    AC2  The A to B split is exactly 50 to 1 and the parts sum to the total.
    AC3  The excess factor multiplies the base volume and stays visible as its own number.
    AC4  Each procedure carries the sample and reagent volumes the manual prints for it.
    AC5  A request that cannot be prepared is refused with the reason.
    AC6  Needing more than one plate is a warning, not a refusal.

  # AC1 — the number printed in MAN0011430
  Scenario: The manual's worked example reproduces to the millilitre
    Given 9 standards, 3 unknowns and 2 replicates
    And the "test tube standard" procedure
    When the working reagent is calculated
    Then 24 wells are required
    And the total volume is 48000 uL

  # AC2
  Scenario: The reagents split fifty to one and sum back to the total
    Given 9 standards, 3 unknowns and 2 replicates
    And the "test tube standard" procedure
    When the working reagent is calculated
    Then reagent A is 47058.82 uL
    And reagent B is 941.18 uL
    And the two reagents sum to the total volume

  # AC4 — the microplate procedure this lab actually runs
  Scenario: The microplate procedure uses 200 uL of reagent per well
    Given 9 standards, 3 unknowns and 2 replicates
    And the "microplate standard" procedure
    When the working reagent is calculated
    Then 24 wells are required
    And the total volume is 4800 uL

  # Boundary: exactly one full plate
  Scenario: A full plate of 96 wells is calculated without a warning
    Given 9 standards, 39 unknowns and 2 replicates
    And the "microplate standard" procedure
    When the working reagent is calculated
    Then 96 wells are required
    And the total volume is 19200 uL
    And the calculation reports no issues

  # AC3
  Scenario: The excess factor scales the total and leaves the split intact
    Given 9 standards, 3 unknowns and 2 replicates
    And the "microplate standard" procedure with an excess factor of 1.1
    When the working reagent is calculated
    Then the total volume is 5280 uL
    And the two reagents sum to the total volume

  # AC4 — the sample to reagent ratios printed in the manual's table
  Scenario Outline: Each procedure carries the volumes and ratio the manual prints
    Given the "<procedure>" procedure
    When its definition is read
    Then the sample volume is <sample> uL
    And the reagent volume is <reagent> uL
    And the working range is <low> to <high> ug/mL

    Examples:
      | procedure                | sample | reagent | low | high |
      | microplate standard      | 25     | 200     | 20  | 2000 |
      | microplate reduced       | 10     | 200     | 125 | 2000 |
      | test tube standard       | 100    | 2000    | 20  | 2000 |
      | test tube enhanced       | 100    | 2000    | 5   | 250  |

  # AC6 — over a plate is a real situation, not a mistake
  @negative
  Scenario: Needing more than one plate warns and still gives the volume
    Given 9 standards, 45 unknowns and 2 replicates
    And the "microplate standard" procedure
    When the working reagent is calculated
    Then the calculation is flagged "PLATE_OVERFLOW" at warn severity
    And the total volume is 21600 uL

  # Empty — nothing to assay
  @negative
  Scenario: A run with no standards and no unknowns is refused
    Given 0 standards, 0 unknowns and 2 replicates
    And the "microplate standard" procedure
    When the working reagent is calculated
    Then the calculation is flagged "NO_SAMPLES" at error severity
    And the total volume is 0 uL

  # Malformed
  @negative
  Scenario Outline: A count that cannot describe a plate is refused by name
    Given <standards> standards, <unknowns> unknowns and <replicates> replicates
    And the "microplate standard" procedure
    When the working reagent is calculated
    Then the calculation is flagged "<code>" at error severity
    And the total volume is 0 uL

    Examples:
      | standards | unknowns | replicates | code                    |
      | 9         | -3       | 2          | NEGATIVE_COUNT          |
      | -1        | 3        | 2          | NEGATIVE_COUNT          |
      | 9         | 3        | 0          | NON_POSITIVE_REPLICATES |
      | 9         | 3        | -2         | NON_POSITIVE_REPLICATES |

  # Boundary — an excess factor below one prepares less than is needed
  @negative
  Scenario: An excess factor below one is refused rather than quietly under-preparing
    Given 9 standards, 3 unknowns and 2 replicates
    And the "microplate standard" procedure with an excess factor of 0.8
    When the working reagent is calculated
    Then the calculation is flagged "EXCESS_BELOW_ONE" at error severity
    And the total volume is 0 uL
