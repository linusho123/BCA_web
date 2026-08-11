# Ported from BCA_quarto features/F01-linalg.feature.md (specdoc §3.2, §4.3).
#
# The Quarto project needed this to be NumPy-free so the same source could run under Pyodide.
# That constraint is gone here, but the reason to keep our own fitter is not: the value of this
# app is that it reproduces LINEST bit-for-bit against historical lab results, and a fitter we
# own is a fitter whose summation order we can pin.

@linalg
Feature: Polynomial least squares without a matrix library

  As the calculation core of the assay
  I want a self-contained polynomial fitter
  So that the standard curve reproduces the workbook's LINEST result exactly

  Acceptance criteria:
    AC1  A cubic fit reproduces the Excel LINEST coefficients to a relative tolerance of 1e-9.
    AC2  Coefficients are returned highest power first, matching numpy.polyfit ordering.
    AC3  A noise-free synthetic polynomial is recovered to its exact coefficients.
    AC4  A rank-deficient design is refused as singular, never as a division by zero.
    AC5  Every refusal names the argument that was wrong.
    AC6  Summation is order-independent, so the fit does not depend on point order.

  # AC1, AC2
  Scenario: A cubic fit reproduces the workbook's LINEST coefficients
    Given the reference standard concentrations and absorbances
    When concentration is fitted on absorbance at degree 3
    Then the fitted coefficients are:
      | power | value               |
      | 3     | -167.37214725621925 |
      | 2     | 555.321622093881    |
      | 1     | 579.0359699552389   |
      | 0     | -71.92532320741356  |

  # AC3
  Scenario: A noise-free cubic is recovered to its exact coefficients
    Given the exact polynomial "2x^3 - 3x^2 + 0.5x + 7" sampled at 10 points
    When concentration is fitted on absorbance at degree 3
    Then the fitted coefficients are:
      | power | value |
      | 3     | 2     |
      | 2     | -3    |
      | 1     | 0.5   |
      | 0     | 7     |

  # AC3 — a lower degree recovers its own shape too
  Scenario: A degree-1 fit recovers the line it was given
    Given the exact polynomial "4x + 1" sampled at 10 points
    When concentration is fitted on absorbance at degree 1
    Then the fitted coefficients are:
      | power | value |
      | 1     | 4     |
      | 0     | 1     |

  # Boundary: n equals degree + 1, the smallest solvable system
  Scenario: An exactly determined system passes through every point
    Given the exact polynomial "2x^3 - 3x^2 + 0.5x + 7" sampled at 4 points
    When concentration is fitted on absorbance at degree 3
    Then the fitted curve passes through every supplied point

  # AC2 — evaluation agrees with the stated coefficient order
  Scenario: Evaluation reads the coefficients highest power first
    Given the coefficients 2, -3, 0.5, 7
    When the polynomial is evaluated at 2
    Then the value is 12

  # AC6 — the reason the core sums exactly rather than with a plain reduce
  Scenario: Reversing the point order does not change the coefficients
    Given the reference standard concentrations and absorbances
    When the same degree-3 fit is run forwards and backwards
    Then both runs return identical coefficients

  # AC4 — a design with no variance in x
  @negative
  Scenario: A fit whose absorbances are all identical is refused as singular
    Given 5 standards whose absorbances are all 0.5
    When concentration is fitted on absorbance at degree 3
    Then the fit is refused as a singular design
    And no coefficients are produced

  # AC5 — empty input, and one point short of the degree
  @negative
  Scenario Outline: A fit with too few points for its degree is refused
    Given <points> points of fitting data
    When concentration is fitted on absorbance at degree <degree>
    Then the fit is refused as insufficient data
    And no coefficients are produced

    Examples:
      | points | degree |
      | 0      | 3      |
      | 3      | 3      |
      | 1      | 1      |

  # AC5 — malformed arguments
  @negative
  Scenario Outline: A malformed fitting request is refused by name
    Given a fitting request that is <defect>
    When the fit is attempted
    Then the request is rejected with "<reason>"
    And no coefficients are produced

    Examples:
      | defect                       | reason                  |
      | 5 x values and 4 y values    | lengths must match      |
      | of degree -1                 | degree must be positive |
      | carrying a NaN in its x data | values must be finite   |
      | carrying an Infinity in y    | values must be finite   |
