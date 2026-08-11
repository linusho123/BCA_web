# Ported from BCA_quarto features/F12-curve-plot.feature.md, geometry half (specdoc §3.6).
#
# DEVIATION FROM THE SOURCE PROJECT, stated deliberately. In BCA_quarto the whole SVG string
# was built inside the calculation core, and the acceptance criterion was that the Python and
# JavaScript ports emit byte-identical markup. That existed because the Quarto project shipped
# one app twice and had no other way to keep the two charts from drifting.
#
# This app ships once, so that reason is gone and the cost — a hand-rolled SVG renderer to
# maintain — is not worth paying. What survives is the half that was load-bearing for
# correctness rather than for parity: the core still produces the geometry model in data
# coordinates, and the chart still computes no number of its own. Rendering moves to ECharts.
# See features/analysis/curve-plot-presentation.feature for what the rendered chart owes.

@curve
Feature: The standard curve as plottable geometry

  As a researcher looking at a calibration curve
  I want the picture built from the same fit the table and the CSV come from
  So that what I see and what I report cannot disagree

  Acceptance criteria:
    AC1  Every point comes from the fit; the chart layer computes no coordinate of its own.
    AC2  The x axis is raw absorbance, the number printed on the reader.
    AC3  The fitted path spans the standards and stops at them.
    AC4  Zero concentration is always inside the plotted range.
    AC5  A row that cannot be placed is named in the omitted list, never plotted at zero.
    AC6  Each point carries only what its kind can be asked about.
    AC7  Nothing throws; a degenerate fit produces an explicit empty state.

  Background:
    Given the reference curve fitted without blank subtraction

  # AC1, AC6
  Scenario: Every fitted standard and analysed sample becomes a point
    Given the analysed samples MCF7 and RPMI8226
    When the curve plot is built
    Then the plot holds 9 standard points and 2 sample points
    And the standards come before the samples

  # AC2 — raw is the number visible in the well, checkable against the plate
  Scenario: The absorbance axis carries the raw reading, not the corrected one
    Given the reference curve fitted with blank subtraction
    When the curve plot is built
    Then each standard's plotted absorbance is its measured mean
    And the concentration plotted against it is what the fit predicts for that reading

  # AC3 — outside the calibrated span the cubic diverges, so drawing it would be a lie
  Scenario: The fitted path spans the standards and goes no further
    Given a sample reading above every standard
    When the curve plot is built
    Then the path runs from the lowest standard mean to the highest
    And the path stops at the highest standard mean

  # AC4 — the blank is a real point and the reference the curve is read against
  Scenario: Zero concentration is always within the plotted range
    Given a set of standards none of which is a blank
    When the curve plot is built
    Then the plotted concentration range includes zero

  # AC5 — the sample is drawn beyond the line rather than off the frame
  Scenario: Bounds stretch to cover a sample past the last standard
    Given a sample reading above every standard
    When the curve plot is built
    Then the plotted absorbance range reaches that sample's absorbance

  # AC6
  Scenario: A point carries only the figure its kind can be asked about
    Given the analysed samples MCF7 and RPMI8226
    When the curve plot is built
    Then each standard point carries a recovery and no coefficient of variation
    And each sample point carries a coefficient of variation and no recovery

  # A residual on every standard is a picket fence; on the one that missed it is the reason
  Scenario: A residual is marked only where recovery missed its band
    When the curve plot is built
    Then exactly one residual is marked
    And it is marked at the 25 ug/mL standard

  # AC1 — an extrapolating sample is identified in the model, not by the renderer
  Scenario: A sample outside the calibrated range is marked as outside it
    Given a sample reading above every standard
    When the curve plot is built
    Then that sample's point is marked as out of range

  # AC5 — plotting an unreadable sample at the origin would fabricate a point on a curve
  @negative
  Scenario: A sample with no readable replicate is omitted by name, not drawn at zero
    Given the sample "Ghost" with every replicate empty
    When the curve plot is built
    Then "Ghost" is absent from the plotted points
    And "Ghost" is named in the omitted list

  # AC5 — the same rule for a standard the fit dropped
  @negative
  Scenario: A standard level dropped from the fit is omitted by name
    Given one level whose replicates are all empty
    When the curve plot is built
    Then that level is absent from the plotted points
    And that level is named in the omitted list

  # AC7 — empty state
  @negative
  Scenario: A fit that produced no coefficients is not plottable and says so
    Given a curve fit that produced no coefficients
    When the curve plot is built
    Then the plot reports that it is not plottable
    And the plot holds no points

  # AC7 — boundary: no span to divide by
  @negative
  Scenario Outline: A degenerate span produces finite bounds rather than a division by zero
    Given <levels> standard levels whose absorbances are all 0.5
    When the curve plot is built
    Then every plotted bound is a finite number
    And no coordinate is NaN or Infinity

    Examples:
      | levels |
      | 1      |
      | 5      |
