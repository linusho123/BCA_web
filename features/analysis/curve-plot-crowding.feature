# The crowded end of the standard curve.
#
# Split from curve-plot-presentation.feature rather than added to it: that file is about the
# readout being one function reached three ways, and this is about which point the pointer is
# asking about in the first place. They fail for different reasons and are worth reading apart.

@analysis @a11y
Feature: Reaching a mark that overlaps its neighbour

  As a researcher checking the bottom of the curve
  I want the crowded low standards to each answer for themselves
  So that the point I am pointing at is the point the chart tells me about

  Acceptance criteria:
    AC1  Pointing at a mark reads out that mark, even where the marks overlap.
    AC2  Which mark is drawn on top does not decide which mark answers.

  The low standards are the crowded ones. The blank and the 25 ug/mL standard differ by 0.027
  absorbance, which at any ordinary chart width puts their centres about ten pixels apart while
  the marks over them are two dozen pixels across — so the hit areas overlap outright and the
  one painted last covers the other. That was always true. What nothing said is that the
  covering must not decide the answer, so when reversing the standard series in
  default-plate-layout.feature AC7 changed which mark paints last, the chart quietly began
  reporting the blank to a reader pointing at the 25 ug/mL standard.

  Tube letters are used to name the standards here because that is what the mark is labelled
  with; I is the blank and H is the 25 ug/mL standard.

  Background:
    Given the analysis page showing the reference curve

  # AC1, AC2 — both crowded marks, by both pointer routes. H is the one the covering hid.
  Scenario Outline: Each crowded standard answers for itself, whichever is drawn on top
    When standard "<tube>" is <route>
    Then the readout names standard "<tube>"

    Examples:
      | tube | route      |
      | I    | pointed at |
      | H    | pointed at |
      | I    | clicked    |
      | H    | clicked    |

  # Without this, the outline above would pass in a chart whose marks never overlap at all, and
  # the rule it exists to pin would go untested the moment the geometry changed. The overlap is
  # the precondition, so it is asserted rather than assumed.
  Scenario: The low standards really do overlap, which is why the rule is needed
    When the chart is rendered
    Then the marks for standards "I" and "H" overlap each other
