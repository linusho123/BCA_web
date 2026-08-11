# Ported from BCA_quarto features/F05-standard-curve.feature.md, negative half (specdoc §6.4).
#
# Split from standard-curve.feature: fitting a curve and judging whether the curve may be
# trusted are different capabilities, and the combined file exceeded the scenario limit.
#
# Every guard here is something the legacy workbook does silently wrong. It extrapolates a
# cubic past the last standard without comment; it never checks whether the fitted curve
# reverses direction inside the calibrated range, which makes back-calculation ambiguous; it
# reports no R squared and no recovery, so a curve fitted to a bad plate looks exactly like a
# curve fitted to a good one.

@curve
Feature: Guarding the standard curve against a fit that cannot be trusted

  As a researcher about to report concentrations off a curve
  I want the curve to tell me when it is not fit to be read off
  So that a bad plate is caught before its numbers reach a figure

  Acceptance criteria:
    AC1  Every quality rule in specdoc §6.4 reports its own issue code.
    AC2  A fit that cannot be computed produces no coefficients and an error, not an exception.
    AC3  A quality warning leaves the fit usable; only an error withholds the coefficients.
    AC4  A curve that reverses direction inside its range is flagged as non-monotonic.
    AC5  A clean reference curve raises none of these guards.

  # AC5 — the control case
  Scenario: The reference curve raises none of the quality guards
    Given the reference standards from the workbook
    And blank subtraction is off
    When the standard curve is fitted
    Then the fit reports no issues at error severity
    And the fit is not flagged "NON_MONOTONIC_CURVE"

  # AC2 — fewer levels than the model has parameters
  @negative
  Scenario Outline: A model with more parameters than levels is refused
    Given <levels> standard levels
    And the "<model>" model
    When the standard curve is fitted
    Then the fit is flagged "INSUFFICIENT_STANDARDS" at error severity
    And no coefficients are produced

    Examples:
      | levels | model             |
      | 3      | inverse cubic     |
      | 2      | inverse quadratic |
      | 1      | inverse linear    |

  # AC2 — a design with no variance to fit
  @negative
  Scenario: Standards whose absorbances are all equal are refused as singular
    Given 5 standard levels whose absorbances are all 0.5
    When the standard curve is fitted
    Then the fit is flagged "SINGULAR_DESIGN" at error severity
    And no coefficients are produced

  # Empty
  @negative
  Scenario: Fitting no standards at all is refused without an exception
    Given 0 standard levels
    When the standard curve is fitted
    Then the fit is flagged "INSUFFICIENT_STANDARDS" at error severity
    And no coefficients are produced

  # Malformed input reaching the fit
  @negative
  Scenario: A standard at a negative concentration is refused
    Given the reference standards from the workbook
    And one level at -100 ug/mL
    When the standard curve is fitted
    Then the fit is flagged "NEGATIVE_CONCENTRATION" at error severity
    And no coefficients are produced

  # AC3 — blank subtraction requested with nothing to subtract
  @negative
  Scenario: Blank subtraction without a blank standard warns and fits unsubtracted
    Given the reference standards without the blank level
    And blank subtraction is on
    When the standard curve is fitted
    Then the fit is flagged "NO_BLANK_STANDARD" at warn severity
    And the fit reports that no blank was subtracted
    And coefficients are produced

  # AC3 — a duplicated concentration is usually a mapping mistake, but it still fits
  @negative
  Scenario: Two levels at the same concentration warn and still fit
    Given the reference standards from the workbook
    And a second level at 500 ug/mL
    When the standard curve is fitted
    Then the fit is flagged "DUPLICATE_STANDARD_CONC" at warn severity
    And coefficients are produced

  # AC4 — the failure mode that makes back-calculation ambiguous
  @negative
  Scenario: A curve that reverses direction inside its range is flagged
    Given standards whose absorbances are scrambled against their concentrations
    When the standard curve is fitted
    Then the fit is flagged "NON_MONOTONIC_CURVE" at warn severity
    And the curve is not monotonic across its calibrated range

  # AC1 — the fit-quality floor
  @negative
  Scenario: A curve whose R squared falls below 0.99 is flagged as a poor fit
    Given standards carrying enough noise to fit worse than 0.99
    When the standard curve is fitted
    Then the fit is flagged "POOR_FIT" at warn severity
    And coefficients are produced

  # AC1 — one standard that does not sit on the curve the others describe
  @negative
  Scenario: A standard recovering outside 80 to 120 percent is named
    Given the reference standards with one level moved far off the curve
    When the standard curve is fitted
    Then the fit is flagged "RECOVERY_OUT_OF_RANGE" at warn severity naming that level
    And coefficients are produced

  # AC1 — a high blank means contaminated reagent, which no other number reveals
  @negative
  Scenario: A blank reading above 0.2 absorbance is flagged as a high blank
    Given the reference standards with the blank reading 0.35
    When the standard curve is fitted
    Then the fit is flagged "HIGH_BLANK" at warn severity
    And coefficients are produced
