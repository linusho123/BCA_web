# Ported from BCA_quarto features/F06-sample-analysis.feature.md (specdoc §3.3, §6.5).
#
# Implements workbook columns F, G and I with the guards the workbook lacks. Its cubic
# extrapolates past the last standard without comment, and a cubic diverges quickly: an
# absorbance a little above the top standard reports a concentration that is not merely
# imprecise but arbitrary. Flagging it is the difference between a number and a guess.

@samples
Feature: Back-calculating unknown sample concentrations

  As a researcher with unknowns on the same plate as the standards
  I want each sample's concentration read off the fitted curve with its dilution undone
  So that I get the concentration of what is in the tube, not of what was in the well

  Acceptance criteria:
    AC1  The workbook's two samples reproduce its concentrations to 1e-9.
    AC2  The dilution factor scales the reported stock concentration linearly.
    AC3  Replicate statistics from the QC layer are attached to every result.
    AC4  An absorbance outside the calibrated range is flagged, never silently extrapolated.
    AC5  A sample with nothing readable is reported as such, not dropped and not zero.
    AC6  Sample order and names are preserved exactly as given.

  Background:
    Given the reference curve fitted without blank subtraction

  # AC1 — the workbook's own RIPA sheet
  Scenario Outline: The workbook's samples reproduce its reported concentrations
    Given the sample "<name>" read at <absorbance> with a dilution factor of 2
    When the samples are analysed
    Then "<name>" is <per_mL> ug/mL in the well
    And "<name>" is <per_uL> ug/uL in the stock

    Examples:
      | name     | absorbance | per_mL             | per_uL              |
      | MCF7     | 0.43       | 266.4318544865975  | 0.532863708973195   |
      | RPMI8226 | 0.36       | 200.68839329745327 | 0.40137678659490655 |

  # AC2
  Scenario Outline: The dilution factor scales the stock concentration
    Given the sample "MCF7" read at 0.43 with a dilution factor of <factor>
    When the samples are analysed
    Then "MCF7" is <per_uL> ug/uL in the stock

    Examples:
      | factor | per_uL             |
      | 1      | 0.2664318544865975 |
      | 10     | 2.664318544865975  |

  # AC1 — the plate gives replicates, not a single reading
  Scenario: Replicates are averaged before the curve is consulted
    Given the sample "MCF7" read at 0.42, 0.43 and 0.44
    When the samples are analysed
    Then "MCF7" has a mean absorbance of 0.43
    And "MCF7" is 266.4318544865975 ug/mL in the well

  # AC3
  Scenario: Replicate quality travels with the result
    Given the sample "MCF7" read at 0.40 and 0.55
    When the samples are analysed
    Then "MCF7" carries a standard deviation and a coefficient of variation
    And "MCF7" is flagged "CV_WARN" at warn severity

  # AC6
  Scenario: Sample order and names survive analysis unchanged
    Given four samples named in a deliberate order
    When the samples are analysed
    Then the results appear in that order with those names

  # AC4 — the invariance that proves standards and samples are corrected alike
  Scenario: A blank-subtracted curve corrects the samples the same way
    Given the reference curve fitted with blank subtraction
    And the sample "MCF7" read at 0.43 with a dilution factor of 2
    When the samples are analysed
    Then "MCF7" is 266.4318544865975 ug/mL in the well

  # AC4 — above and below the calibrated span
  @negative
  Scenario Outline: A sample outside the calibrated range is flagged, not extrapolated quietly
    Given the sample "Odd" read at <absorbance> with a dilution factor of 1
    When the samples are analysed
    Then "Odd" is marked as extrapolated
    And "Odd" is flagged "EXTRAPOLATED" at warn severity

    Examples:
      | absorbance |
      | 2.5        |
      | 0.05       |

  # AC4 — below the blank means the well is emptier than water
  @negative
  Scenario: A sample reading below the blank is flagged as such
    Given the sample "Odd" read at 0.10 with a dilution factor of 1
    When the samples are analysed
    Then "Odd" is flagged "BELOW_BLANK" at warn severity

  # The cubic can return a negative concentration; the value is kept so it can be seen
  @negative
  Scenario: A negative fitted concentration is flagged and kept for inspection
    Given a sample whose fitted concentration is negative
    When the samples are analysed
    Then that sample is flagged "NEGATIVE_CONCENTRATION_RESULT" at warn severity
    And the negative value is still reported

  # AC5 — empty
  @negative
  Scenario: A sample with no readable replicate is reported rather than dropped
    Given the sample "Ghost" with every replicate empty
    When the samples are analysed
    Then "Ghost" appears in the results
    And "Ghost" has no mean absorbance and no concentration
    And "Ghost" is flagged "NO_DATA" at info severity

  # Malformed — the dilution factor is a typed input
  @negative
  Scenario Outline: A dilution factor that cannot scale anything is refused
    Given the sample "MCF7" read at 0.43 with a dilution factor of <factor>
    When the samples are analysed
    Then "MCF7" is flagged "DILUTION_FACTOR_INVALID" at error severity
    And "MCF7" has no stock concentration

    Examples:
      | factor |
      | 0      |
      | -2     |

  # State — the curve upstream failed
  @negative
  Scenario: Analysing against a failed curve carries the error rather than throwing
    Given a curve fit that produced no coefficients
    And the sample "MCF7" read at 0.43 with a dilution factor of 2
    When the samples are analysed
    Then "MCF7" is flagged "CURVE_UNAVAILABLE" at error severity
    And no exception escapes the analyser
