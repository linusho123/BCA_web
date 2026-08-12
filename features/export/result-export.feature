# Ported from BCA_quarto features/F09-export.feature.md (specdoc §4.3, §3.4).
#
# The app offers three switches that change the numbers — blank subtraction, the fit model, and
# the dilution factor. A CSV that records the numbers but not the switches is unreproducible:
# six months later nobody can say whether that column came from the cubic or the quadratic.
# So every export carries a provenance block, and the block is part of the contract.

@export
Feature: Exporting results with the provenance to reproduce them

  As a researcher writing up an experiment months after running it
  I want every exported table to record the settings that produced it
  So that a number in a figure can be traced back to the plate it came from

  Acceptance criteria:
    AC1  Every CSV re-parses to the row count it claims, with the expected column names.
    AC2  Provenance records the model, the blank-subtraction state, the coefficients and R2.
    AC3  An absent value renders as an empty field, never as the text "None" or "null".
    AC4  A field containing a comma, a quote or a newline survives a round trip intact.
    AC5  The session serialises to JSON that parses back without loss.
    AC6  A failed or empty result set exports cleanly rather than throwing.

  # AC1
  Scenario: The dilution plan exports one row per vial under named columns
    Given the reference dilution plan
    When it is exported as CSV
    Then the CSV re-parses to 9 data rows
    And the columns include "vial_id", "volume_from_source_uL" and "leftover_uL"

  # AC1, AC2
  Scenario: The curve export carries its coefficients and fit quality
    Given the reference curve fitted without blank subtraction
    When it is exported as CSV
    Then the provenance block records the coefficients "a", "b", "c" and "d"
    And the provenance block records the R squared

  # AC2 — the switches, which are the whole point of the block
  Scenario: Provenance names the model and the blank-subtraction state
    Given the reference curve fitted with blank subtraction using the quadratic model
    When the provenance block is built
    Then it names the model "inverse_quadratic"
    And it records that blank subtraction was on

  # AC1
  Scenario: The sample export carries concentrations at full precision
    Given the analysed samples MCF7 and RPMI8226
    When they are exported as CSV
    Then the CSV re-parses to 2 data rows
    And the concentration of "MCF7" reads 266.4318544865975

  # AC2 — an issue that is not exported is an issue nobody acts on
  Scenario: Exported rows carry the issue codes attached to them
    Given analysed samples carrying issues
    When they are exported as CSV
    Then each row's issues column lists that row's codes

  # AC5
  Scenario: A whole session round-trips through JSON
    Given a complete session with a plate, a curve and samples
    When the session is serialised and parsed back
    Then the parsed session holds the same values

  # AC3 — "None" in a numeric column is the bug this prevents
  @negative
  Scenario: An absent value exports as an empty field
    Given a sample with no concentration
    When it is exported as CSV
    Then its concentration field is empty
    And the field is not the text "None"

  # AC4 — the CSV injection classic, from a real sample naming convention
  @negative
  Scenario Outline: A sample name carrying CSV punctuation survives a round trip
    Given a sample named <name>
    When it is exported as CSV and re-parsed
    Then the name comes back exactly as written
    And the CSV re-parses to 1 data row

    Examples:
      | name                |
      | HeLa, passage 12    |
      | clone "A"           |
      | line one\nline two  |

  # AC6 — empty
  @negative
  Scenario: An empty result set exports as a header and nothing else
    Given no analysed samples
    When they are exported as CSV
    Then the CSV re-parses to 0 data rows
    And the header row is still present

  # AC6 — a failed fit still has to leave an audit trail
  @negative
  Scenario: A curve that failed to fit exports its failure rather than throwing
    Given a curve fit that produced no coefficients
    When it is exported as CSV
    Then the provenance block records that the fit failed
    And the provenance block lists the issues that caused it

  # AC5 — Infinity and NaN are not JSON
  @negative
  Scenario: A non-finite value serialises as null rather than invalid JSON
    Given a sample whose concentration is Infinity
    When the session is serialised
    Then that value is written as null
    And the session parses back without error
