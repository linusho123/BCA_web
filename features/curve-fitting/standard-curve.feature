# Ported from BCA_quarto features/F05-standard-curve.feature.md (specdoc §3.2, §3.4).
#
# The workbook fits LINEST(conc, abs^{1,2,3}) — concentration on absorbance, an inverse
# calibration. Classical calibration regresses response on concentration and inverts, so this
# is unorthodox; it is also what every historical result in this lab was computed with, and it
# is trivially invertible. It is reproduced exactly and named INVERSE_CUBIC so that nobody
# mistakes it for a classical fit.
#
# Blank subtraction is the Pierce manual's steps 5 and 6, which the workbook skips. Both modes
# ship: on by default per the manual, off to reproduce the legacy sheet coefficient for
# coefficient. The mode changes the numbers, so it is stamped on every export.

@curve
Feature: Fitting the standard curve

  As a researcher who has read a plate of BSA standards
  I want a calibration curve that agrees with the sheet the lab has always used
  So that today's concentrations are comparable with the ones already in the notebooks

  Acceptance criteria:
    AC1  Without blank subtraction the reference standards give the Excel coefficients.
    AC2  Prediction at the workbook's own sample absorbances reproduces its concentrations.
    AC3  Replicates are averaged per level before the fit sees them.
    AC4  Blank subtraction shifts the coefficients without moving the predictions.
    AC5  The calibrated absorbance range is recorded, so extrapolation can be detected later.
    AC6  Fit quality is reported as R squared and as recovery per standard.
    AC7  Quadratic and linear models are available under the same interface.

  Background:
    Given the reference standards from the workbook

  # AC1 — the four numbers the workbook prints
  Scenario: The reference standards reproduce the workbook's coefficients
    Given blank subtraction is off
    When the standard curve is fitted
    Then the fitted coefficients are:
      | power | value               |
      | 3     | -167.37214725621925 |
      | 2     | 555.321622093881    |
      | 1     | 579.0359699552389   |
      | 0     | -71.92532320741356  |

  # AC2 — the workbook's own two samples, read straight off the fit
  Scenario: Predictions reproduce the workbook's reported concentrations
    Given blank subtraction is off
    When the standard curve is fitted
    Then predicting 0.43 gives 266.4318544865975 ug/mL
    And predicting 0.36 gives 200.68839329745327 ug/mL

  # AC3 — the plate holds replicates; the fit takes one value per level
  Scenario: Replicates are averaged per level before the fit
    Given each level given two replicates averaging to its reference absorbance
    And blank subtraction is off
    When the standard curve is fitted
    Then the coefficients equal those of the single-replicate fit

  # AC4 — the invariance that makes the two modes safe to offer
  Scenario: Blank subtraction moves the coefficients but not the predictions
    Given blank subtraction is on
    When the standard curve is fitted
    Then the mean blank absorbance is 0.132
    And correcting 0.43 gives 0.298
    And predicting 0.43 still gives 266.4318544865975 ug/mL

  # AC5 — recorded in the space the fit works in, so the range is the blank-corrected one
  Scenario: The calibrated absorbance range is recorded
    Given blank subtraction is off
    When the standard curve is fitted
    Then the calibrated range runs from 0.132 to 2.051 absorbance

  # AC6 — measured, not aspirational: the cubic does not interpolate these nine points
  Scenario: Fit quality is reported for the reference curve
    When the standard curve is fitted
    Then the R squared is above 0.998
    And the curve is monotonic across its calibrated range

  # AC6 — a genuine finding in the reference data, which the workbook reports nowhere
  Scenario: Recovery is reported per standard and flags the lowest one
    When the standard curve is fitted
    Then one recovery is reported per standard level
    And the blank has no recovery
    And the 25 ug/mL standard recovers at about 134 percent
    And every other standard recovers between 80 and 120 percent

  # AC7
  Scenario Outline: A lower-order model fits under the same interface
    Given the "<model>" model
    When the standard curve is fitted
    Then <count> coefficients are returned
    And the R squared is above <floor>

    Examples:
      | model              | count | floor |
      | inverse quadratic  | 3     | 0.99  |
      | inverse linear     | 2     | 0.9   |

  # AC7 — the cubic is the default for a reason
  Scenario: The linear model fits the working range worse than the cubic
    When each model is fitted in turn
    Then the linear R squared is below the cubic R squared

  # A level whose wells all read OVRFLW is not a level
  @negative
  Scenario: A level with nothing readable in it is dropped and reported
    Given one level whose replicates are all empty
    When the standard curve is fitted
    Then the fit uses 8 levels
    And the fit is flagged "LEVEL_DROPPED" at warn severity

  # State — asking a failed fit for a number
  @negative
  Scenario: Predicting from a fit that failed is refused rather than answered
    Given a curve fit that produced no coefficients
    When a prediction is attempted
    Then the prediction is refused as an unfitted curve
    And the refusal names the issues that caused it
