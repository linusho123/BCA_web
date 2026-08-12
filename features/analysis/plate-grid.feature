# Scoped 2026-08-11. Not yet implemented — see spec/OUT-OF-SCOPE.md.
#
# These files live in spec/ rather than features/ on purpose. vite.config.ts globs
# features/**/*.feature into the acceptance project, so a scenario landing there runs
# immediately against a step registry that has nothing to bind it, and the gate goes red.
# Move each file into features/analysis/ as its steps are written, and register any file
# whose subject is the rendered page in UI_FEATURES at the same time.
#
# The grid replaces nothing. Paste, typing and import all fill the same 96 wells, and every
# stage downstream reads what the grid holds rather than the text that filled it.

@plate
Feature: Entering a plate on a 96-well grid

  As a researcher with a plate of absorbances and no clean export
  I want to type into the wells themselves rather than into a block of text
  So that what I see on screen is laid out the way the plate on my bench is

  Acceptance criteria:
    AC1  The grid shows all 96 wells before any data exists, and every well is typeable.
    AC2  Pasting a grid fills the wells; the paste box and the grid are one input, not two.
    AC3  A well holding no number is empty rather than zero, and never invents a value.
    AC4  Typed absorbances survive a reload and do not outlive the tab.
    AC5  Nothing typed into a well is written where it would still be there tomorrow.
    AC6  A negative reading is a measurement; only text that is not a number is refused.

  Rows run A to H and columns 1 to 12 throughout. Where a scenario names a single well it
  gives it as a row letter and a column number, the way a reader labels it.

  Background:
    Given the analysis page with an empty grid

  # AC1 — the state the page opens in, before anything has been entered
  Scenario: An empty grid offers all 96 wells
    Then the grid shows 8 rows and 12 columns
    And every well in the grid is empty
    And the page states that a plate is needed to begin

  # AC1 — the smallest thing a person can do here
  Scenario: Typing a number into a well puts it in the plate
    When well "C1" is typed into with "0.430"
    Then well "C1" holds 0.430
    And the page no longer states that a plate is needed to begin

  # AC2 — the existing paste path, landing in the new surface
  Scenario: Pasting a grid fills the wells it covers
    When the workbook's plate is pasted into the paste box
    Then well "A1" holds 0.132
    And well "C1" holds 0.430
    And the grid shows 8 rows and 12 columns

  # AC2 — paste and typing are the same input, so the later one wins
  Scenario: Typing over a pasted well replaces only that well
    Given the workbook's plate pasted into the paste box
    When well "A3" is typed into with "0.2705"
    Then well "A3" holds 0.2705
    And well "A4" holds 0.391

  # AC3 — an empty well is absent, not zero; a zero absorbance is a real reading
  Scenario Outline: A well reads back exactly what was entered in it
    When well "D5" is typed into with "<entered>"
    Then well "D5" reads "<shown>"

    Examples:
      | entered  | shown    |
      | 0.430    | 0.430    |
      | 0        | 0        |
      | 0.000001 | 0.000001 |
      | 2.5      | 2.5      |

  # AC6 — a reader really does report slightly negative optical densities, and blank
  # subtraction produces them by design. Refusing them at the well would throw away readings
  # the rest of the app is built to handle.
  Scenario: A negative reading is accepted as a measurement
    When well "D5" is typed into with "-0.012"
    Then well "D5" holds -0.012
    And well "D5" is not flagged as holding an unreadable entry

  # AC3 — the entry stays in the box. Swallowing it would make the well unusable: "0.132" is
  # not a number for the first three keystrokes, and a grid that cleared what it could not yet
  # read would be a grid nobody could type in. What changes is that the well is marked as
  # holding nothing the analysis can use.
  @negative
  Scenario Outline: A well marks an entry that is not a measurement
    When well "D5" is typed into with "<entered>"
    Then well "D5" reads "<entered>"
    And well "D5" is marked as holding no measurement
    And well "D5" is flagged as holding an unreadable entry

    Examples:
      | entered |
      | OVRFLW  |
      | abc     |

  # AC4 — the reload case, which is why typed numbers are held at all
  Scenario: Typed absorbances survive a reload of the page
    Given well "C1" typed into with "0.430"
    When the page is reloaded in the same tab
    Then well "C1" holds 0.430

  # AC5 — the promise the holding is bounded by
  @negative
  Scenario: Typed absorbances do not outlive the tab they were entered in
    Given well "C1" typed into with "0.430"
    When the tab is closed and the app is opened again
    Then every well in the grid is empty
    And no absorbance is found in storage that outlives the tab
