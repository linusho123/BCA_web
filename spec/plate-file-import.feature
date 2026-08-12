# Scoped 2026-08-11. Not yet implemented — see spec/OUT-OF-SCOPE.md.
#
# parsePlateCsv, decodePlateBytes and UploadSchema already exist and are referenced by nothing
# outside src/domain and src/schemas — verified by grep over src/ui and src/state, zero hits.
# The parsing is built; what is missing is the step that finds a grid inside a file that is
# not only a grid, and the surface that reports what it found.
#
# The refusals here were chosen over guessing after measurement, not on principle. A reader
# export with a three-line metadata header currently parses to a 12-row, 13-column plate with
# invented row labels R9 to R12; a file holding two reads parses to a 16-row plate with the
# labels A to H twice and only a warning. The second is the dangerous one: it looks like a
# plate, and every stage downstream computes on it.

@plate
Feature: Filling the grid from a reader file

  As a researcher who has just exported a plate from the instrument
  I want the file to fill the grid without me retyping or trimming it
  So that the only work left is saying which wells hold which sample

  Acceptance criteria:
    AC1  A file holding one plate-shaped grid fills the grid, whatever surrounds it.
    AC2  What was skipped is reported, so a wrong read is visible rather than silent.
    AC3  A file that does not hold exactly one 8 by 12 grid is refused, never guessed at.
    AC4  A refusal names what is wrong with the file in terms of the file.
    AC5  An import that landed can be undone, restoring what was there before it.
    AC6  An import clears sample painting; nothing carries over onto new numbers.
    AC7  A refused import changes nothing at all.

  Every file below is a CSV exported from a plate reader. Sizes are given in rows by columns
  of the numeric block, not of the file, which may carry any amount of text around it.

  Background:
    Given the analysis page with an empty grid

  # AC1 — the file this was built for
  Scenario: A bare grid fills every well it covers
    When a file holding an 8 by 12 grid is imported
    Then well "A1" holds 0.132
    And well "H12" holds 2.051
    And the grid shows 8 rows and 12 columns

  # AC1 — "8 by 12" counts the grid's cells, not how many of them hold a number. The
  # workbook's own plate is 24 readings in an 8 by 12 frame, rows E to H empty; counting
  # numbers instead would refuse the app's own worked example.
  Scenario: A grid whose lower rows are empty is still 8 by 12
    When a file holding an 8 by 12 grid with rows "E" to "H" empty is imported
    Then well "A1" holds 0.132
    And well "E1" is empty
    And the import is not refused

  # AC1 and AC2 — the export an instrument actually produces
  Scenario: A grid under an instrument header is found and the header reported
    When a file holding 3 lines of instrument metadata above an 8 by 12 grid is imported
    Then well "A1" holds 0.132
    And the import reports that it skipped 3 lines above the grid

  # AC2 — the report is what makes an automatic import checkable
  Scenario: The import names the lines it read the grid from
    When a file holding 3 lines of instrument metadata above an 8 by 12 grid is imported
    Then the import reports the lines the grid was read from
    And the import reports that it read one grid

  # AC3 — the measured hazard: two reads that parse into one plausible wrong plate
  @negative
  Scenario: A file holding two grids is refused rather than halved
    When a file holding two 8 by 12 grids is imported
    Then the import is refused
    And every well in the grid is empty
    And the refusal states that the file holds 2 grids

  # AC3 and AC4 — the shape floor, given as the spread of shapes a file can hold
  @negative
  Scenario Outline: A grid that is not 8 by 12 is refused with its own shape named
    When a file holding a <rows> by <cols> grid is imported
    Then the import is refused
    And the refusal states that the grid is <rows> by <cols>
    And every well in the grid is empty

    Examples:
      | rows | cols |
      | 4    | 12   |
      | 8    | 11   |
      | 16   | 12   |
      | 16   | 24   |

  # AC4 — a file with no grid in it at all
  @negative
  Scenario: A file holding no grid is refused as holding none
    When a file holding no numbers at all is imported
    Then the import is refused
    And the refusal states that no grid was found

  # AC6 — the safety rule, on the path it was ruled for
  Scenario: An import clears the sample painting
    Given the workbook's plate loaded with wells "C1:C3" assigned to "MCF7"
    When a file holding an 8 by 12 grid is imported
    Then no well is assigned to a sample
    And wells "A1:A9" are assigned to the standards

  # AC5 — the way back from an import that read the wrong file
  Scenario: Undoing an import restores the plate and the painting it replaced
    Given the workbook's plate loaded with wells "C1:C3" assigned to "MCF7"
    And a file holding an 8 by 12 grid imported
    When the import is undone
    Then well "C1" holds 0.430
    And wells "C1:C3" are assigned to "MCF7"

  # AC7 — a refusal is not a change; the plate on screen is the one that was there
  @negative
  Scenario: A refused import leaves the plate and the painting untouched
    Given the workbook's plate loaded with wells "C1:C3" assigned to "MCF7"
    When a file holding two 8 by 12 grids is imported
    Then the import is refused
    And well "C1" holds 0.430
    And wells "C1:C3" are assigned to "MCF7"
