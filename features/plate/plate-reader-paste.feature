# Ported from BCA_quarto features/F03-plate-parsing.feature.md (specdoc §6.3).
#
# The workbook's instruction is "paste, then Paste Special, values only". A browser has no
# paste-special, so the parser has to be tolerant of whatever the reader put on the clipboard:
# tabs, commas, aligned columns, with or without the row letters and column numbers the reader
# prints around the grid.
#
# The hard rule is that parsing never throws. A researcher pastes once and then edits; every
# intermediate state has to annotate the grid rather than blank it.

@plate
Feature: Reading a plate reader's pasted output

  As a researcher who has just read a plate
  I want the numbers off my clipboard however the reader chose to format them
  So that no absorbance is retyped by hand on its way into the curve

  Acceptance criteria:
    AC1  Tab, comma and whitespace delimited grids parse to identical values.
    AC2  A leading row-letter column and a header row of column numbers are stripped.
    AC3  Parsing never throws; every failure is an issue naming the well it belongs to.
    AC4  Instrument sentinels become empty wells with an issue, never a number.
    AC5  A grid that is not 8x12 is accepted and flagged, not rejected.
    AC6  A well is addressed by its plate name, so A1 in the app is A1 on the bench.

  # AC1 — the three delimiters a reader might emit
  Scenario Outline: A grid parses the same however its columns are separated
    Given an 8x12 grid of absorbances separated by <delimiter>
    When the plate text is parsed
    Then the plate is 8 rows by 12 columns
    And well "A1" holds the first value of the grid
    And the plate reports no issues

    Examples:
      | delimiter        |
      | tabs             |
      | commas           |
      | runs of spaces   |

  # AC2, AC6
  Scenario: Row letters and a column header are stripped from the grid
    Given an 8x12 grid labelled with row letters and a column number header
    When the plate text is parsed
    Then the plate is 8 rows by 12 columns
    And the row labels are "A" through "H"
    And the plate reports no issues

  # AC1 — the reader pads its export; the padding is not data
  Scenario: Blank lines and trailing whitespace do not change the shape
    Given an 8x12 grid of absorbances padded with blank lines and trailing tabs
    When the plate text is parsed
    Then the plate is 8 rows by 12 columns
    And the plate reports no issues

  # AC6 — the accessors the mapping layer is built on
  Scenario: A parsed plate can be read by row and by column
    Given an 8x12 grid of absorbances separated by tabs
    When the plate text is parsed
    Then row "A" holds 12 values
    And column 3 holds 8 values

  # AC5 — the shape this assay is actually run at
  Scenario: The workbook's two populated rows parse and are flagged as an odd shape
    Given the workbook's RIPA plate of 2 rows by 11 columns
    When the plate text is parsed
    Then the plate is flagged "UNEXPECTED_SHAPE" at warn severity
    And the parsed values match the workbook

  # AC4 — sentinels, per well
  @negative
  Scenario Outline: An instrument sentinel becomes an empty well with an issue
    Given an 8x12 grid whose well "C5" reads "<sentinel>"
    When the plate text is parsed
    Then well "C5" is empty
    And the plate is flagged "OVERFLOW_CELL" at warn severity naming "C5"

    Examples:
      | sentinel |
      | OVRFLW   |
      | Overflow |
      | ####     |
      | sat      |

  # AC3, AC4 — text that is neither a number nor a known sentinel
  @negative
  Scenario: A cell that is not a number becomes an empty well naming itself
    Given an 8x12 grid whose well "B2" reads "abc"
    When the plate text is parsed
    Then well "B2" is empty
    And the plate is flagged "NON_NUMERIC_CELL" at warn severity naming "B2"

  # AC3 — the value is kept, because the researcher has to see it to judge it
  @negative
  Scenario: A negative absorbance is flagged and kept
    Given an 8x12 grid whose well "D4" reads "-0.05"
    When the plate text is parsed
    Then well "D4" holds -0.05
    And the plate is flagged "NEGATIVE_ABSORBANCE" at warn severity naming "D4"

  # Empty
  @negative
  Scenario Outline: An empty paste is refused without producing a grid
    Given a plate paste of <input>
    When the plate text is parsed
    Then the plate is flagged "EMPTY_INPUT" at error severity
    And the plate holds no values

    Examples:
      | input             |
      | an empty string   |
      | only whitespace   |
      | only blank lines  |

  # Malformed — rows of different widths. The error stops the analysis; the grid stays on screen,
  # because "row 2 is short" is only actionable next to the row it is talking about.
  @negative
  Scenario: A grid whose rows differ in width is refused naming the row
    Given a grid whose rows hold 12, 11 and 12 cells
    When the plate text is parsed
    Then the plate is flagged "RAGGED_ROWS" at error severity naming row 2
    And the rows that did parse are still shown

  # Malformed — the header must not be mistaken for the ragged row
  @negative
  Scenario: A ragged grid under a valid header is still reported as ragged
    Given a column number header above rows holding 12, 11 and 12 cells
    When the plate text is parsed
    Then the plate is flagged "RAGGED_ROWS" at error severity naming row 2

  # Empty at the other end — a grid of nothing but sentinels
  @negative
  Scenario: A plate with no readable well at all is an error, not 96 warnings
    Given an 8x12 grid entirely of "OVRFLW"
    When the plate text is parsed
    Then every well is empty
    And the plate is flagged "NO_READABLE_CELLS" at error severity
