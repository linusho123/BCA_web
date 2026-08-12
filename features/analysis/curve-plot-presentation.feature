# Ported from BCA_quarto features/F12-curve-plot.feature.md, presentation half.
#
# The geometry lives in the domain (curve-plot-geometry.feature); this is what the rendered
# chart owes its reader. These scenarios are proven at component altitude, because "focus shows
# what hover shows" is a claim about a rendered chart and cannot be checked anywhere else.
#
# The rule underneath all of it: the plot enhances and never gates. Every number it shows is
# also in the standards table beside it. A reader who cannot use the chart — colourblind, on a
# greyscale printout, in forced-colours mode, with reduced motion, with a screen reader — loses
# nothing but convenience.

@analysis @a11y
Feature: Reading the standard curve chart

  As a researcher checking which point is the outlier
  I want the chart to answer that by hover, click or keyboard alike
  So that the way I happen to be using the page does not decide what I can find out

  Acceptance criteria:
    AC1  Identity is never carried by colour alone; shape differs as well as hue.
    AC2  Everything hoverable is focusable, and focus shows exactly what hover shows.
    AC3  A legend naming both series is always drawn.
    AC4  Direct labels are used up to four samples and dropped beyond that.
    AC5  Every number the chart shows is also in the standards table beside it.
    AC6  Reduced motion removes all animation and changes nothing the chart says.
    AC7  Numbers above 999 are grouped as a reader writes them.

  Background:
    Given the analysis page showing the reference curve

  # AC1 — shape survives a colourblind reader, greyscale and forced colours; hue survives none
  Scenario: Standards and samples differ in shape, not only in colour
    When the chart is rendered
    Then the standard marks and the sample marks use different shapes

  # AC3
  Scenario: The legend names both series whenever a curve is plotted
    When the chart is rendered
    Then the legend names the standards and the samples

  # AC2 — the readout is one function, reached three ways.
  #
  # A mid-curve standard, deliberately: the low standards overlap one another on screen, and a
  # pointer aimed at one of those is asking a question about crowding rather than about the
  # readout. That question has its own answer in curve-plot-crowding.feature, and asking it here
  # too would only mean this scenario failed for two unrelated reasons at once.
  Scenario Outline: Hover, click and keyboard focus all reach the same readout
    When the 500 ug/mL standard is reached by <route>
    Then the readout names that standard
    And the readout states its absorbance and its concentration

    Examples:
      | route          |
      | pointer hover  |
      | click          |
      | keyboard focus |

  # AC2 — a chart whose points cannot be tabbed to is a chart with a keyboard-shaped hole
  Scenario: Every plotted point can be reached with the keyboard
    When the chart is rendered
    Then every plotted point is focusable in turn
    And each focused point announces its label to assistive technology

  # AC4
  Scenario Outline: Direct labels appear while there are few enough to read
    Given <samples> analysed samples
    When the chart is rendered
    Then <labelled> sample marks carry a direct label

    Examples:
      | samples | labelled |
      | 1       | 1        |
      | 4       | 4        |
      | 5       | 0        |

  # AC7
  Scenario: Concentrations above 999 are thousands-grouped
    When the chart is rendered
    Then the concentration axis reads "1,000" rather than "1000"

  # AC5 — the plot is a second view of the table, never the only view
  Scenario: Every number in the chart also appears in the table beside it
    When the chart is rendered
    Then the standards table is shown alongside it
    And each plotted standard has a row in that table

  # AC1 — an out-of-range sample is distinguished by fill, not by hue
  Scenario: A sample outside the calibrated range renders differently from one inside it
    Given a sample reading above every standard
    When the chart is rendered
    Then that sample's mark is drawn hollow

  # AC6
  @negative
  Scenario: Reduced motion removes the animation without changing the chart
    Given the reader prefers reduced motion
    When the chart is rendered
    Then no mark is animated
    And the chart shows the same points and the same readout

  # AC5 — the empty state must not look like a curve with no data on it
  @negative
  Scenario: A fit that could not be computed shows a message, not an empty frame
    Given a curve fit that produced no coefficients
    When the chart is rendered
    Then the chart area states why there is nothing to plot
    And no axes are drawn

  # Malformed — a sample name is user input and reaches the label and the aria-label
  @negative
  Scenario: A sample name containing markup is shown as text, not interpreted
    Given a sample named "<b>&\"x\""
    When the chart is rendered
    Then that name is displayed exactly as written
    And no element from that name appears in the document

  # AC2 — the readout must not become stale when focus leaves
  @negative
  Scenario: Moving away from every point clears the readout rather than freezing it
    Given the 500 ug/mL standard is focused
    When focus leaves the chart
    Then the readout no longer names that standard
