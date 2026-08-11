# Ported from BCA_quarto features/F11-plate-mapping.feature.md, region half (specdoc §5.7).
#
# This is the link between a parsed grid and the values the curve takes. Before it existed, the
# analysis page rendered a summary of the pasted plate and then asked the user to retype every
# absorbance into two text boxes, from a photograph of the reader screen. That transcription
# step is where a wrong digit enters silently and rides the cubic into every reported number.
#
# Wells are named the way a plate is described on paper — A1:A9 for the standard series,
# C1:C3 for a sample's replicates — so a mapping can be checked against a lab notebook without
# translating anything.

@plate
Feature: Mapping plate wells to standards and samples

  As a researcher whose plate is laid out the way this week's experiment needed
  I want to say which wells hold which standard and which sample in plate notation
  So that the curve is driven by the plate I actually ran

  Acceptance criteria:
    AC1  A span, a comma list, and a mixture of both resolve to explicit well labels.
    AC2  A span runs along one row or one column; a rectangular span is refused.
    AC3  Nothing throws; every malformed region comes back as an issue.
    AC4  A well claimed by two regions is an error, because it is wrong in both places.
    AC5  Standards mapped from a plate fit to the same coefficients as values passed directly.
    AC6  A region written in any case or spacing resolves to the same wells.

  # AC1, AC6
  Scenario Outline: A region resolves to the wells a researcher would read off it
    Given the region "<region>"
    When the region is resolved
    Then the wells are "<wells>"
    And the region reports no issues

    Examples:
      | region       | wells             |
      | A1:A9        | A1,A2,A3,A4,A5,A6,A7,A8,A9 |
      | A1:H1        | A1,B1,C1,D1,E1,F1,G1,H1    |
      | A1,B2,C3     | A1,B2,C3                   |
      | A1:A3, C1    | A1,A2,A3,C1                |
      |  a1 : a3     | A1,A2,A3                   |

  # AC1 — direction is information, not noise: it is how a reversed series is expressed
  Scenario: A descending span keeps the direction it was written in
    Given the region "A9:A1"
    When the region is resolved
    Then the wells are "A9,A8,A7,A6,A5,A4,A3,A2,A1"

  # AC5 — the scenario that makes mapping safe to trust
  Scenario: A curve mapped from the plate equals the curve fitted from values
    Given a plate whose row A holds the nine reference absorbances
    When the standards are mapped from "A1:A9" and fitted
    Then the coefficients equal those of the curve fitted from the values directly

  Scenario: Two standard regions become two replicates per level
    Given a plate whose rows A and B both hold the nine reference absorbances
    When the standards are mapped from "A1:A9" and "B1:B9"
    Then each standard level carries 2 replicates

  Scenario: A sample region becomes one sample with its replicates
    Given a plate whose row C holds three absorbances
    When the sample "MCF7" is mapped from "C1:C3"
    Then one sample named "MCF7" is produced with 3 replicates

  # Display: the tube letter the researcher labelled the vial with
  Scenario: Tube identifiers travel with the standards they label
    Given a plate whose row A holds the nine reference absorbances
    When the standards are mapped from "A1:A9" with tube identifiers
    Then each standard level carries its tube label

  # AC2, AC3 — malformed region text
  @negative
  Scenario Outline: A malformed region is refused by name and yields no wells
    Given the region "<region>"
    When the region is resolved
    Then the region is flagged "<code>" at error severity
    And no wells are produced

    Examples:
      | region | code              |
      | zz     | BAD_REGION_SYNTAX |
      | A      | BAD_REGION_SYNTAX |
      | A1:B9  | BAD_REGION_SYNTAX |
      | A0     | BAD_REGION_SYNTAX |
      |        | EMPTY_REGION      |

  # AC3 — the region names more or fewer wells than there are concentrations
  @negative
  Scenario: A standard region of the wrong length reports both counts
    Given a plate whose row A holds the nine reference absorbances
    When the standards are mapped from "A1:A5" against nine concentrations
    Then the mapping is flagged "REGION_LENGTH_MISMATCH" at error severity
    And no standard levels are produced

  # Absent — the region runs off the parsed grid
  @negative
  Scenario: A region reaching past the parsed grid names the wells that are missing
    Given a plate of 2 rows by 9 columns
    When the standards are mapped from "A1:A12" against twelve concentrations
    Then the mapping is flagged "REGION_OUT_OF_BOUNDS" at error severity naming "A10"
    And no standard levels are produced

  # AC3 — an unreadable well inside an otherwise valid region
  @negative
  Scenario: An unreadable well inside a region is named and left empty
    Given a plate whose row C holds three absorbances and well "C2" read "OVRFLW"
    When the sample "MCF7" is mapped from "C1:C3"
    Then the mapping is flagged "UNREADABLE_WELL_IN_REGION" at warn severity naming "C2"
    And the sample "MCF7" carries 3 replicates of which one is empty

  # AC4 — the same well counted twice gives a plausible wrong answer in both places
  @negative
  Scenario: A well claimed by both a standard and a sample is refused naming both
    Given a plate whose row A holds the nine reference absorbances
    When the standards take "A1:A9" and the sample "MCF7" takes "A1"
    Then the mapping is flagged "OVERLAPPING_REGIONS" at error severity naming "A1"
    And both claimants are named in the issue

  # AC3 — the property the editable mapping table depends on
  @negative
  Scenario: Hostile region text returns issues rather than throwing
    Given regions of random punctuation, huge column numbers and unicode
    When each region is resolved
    Then every region reports an issue at error severity
    And no exception escapes the mapper
