# Ported from BCA_quarto features/F11-plate-mapping.feature.md, import half (specdoc §6.3).
#
# The reader can export CSV, and a CSV carries the numbers as numbers: no photograph of the
# instrument screen, no retyping, no decimal point to misread. Upload is therefore the route
# with the least transcription risk in it, and the one the interface should recommend.
#
# The failure this guards is a researcher dragging in the .xlsx they saved from the reader
# software. Decoding a zip archive as text produces a grid of mojibake that parses to a plate
# of empty wells and a hundred warnings. Naming the file type instead is a one-line fix that
# tells them exactly what to do.

@plate
Feature: Importing a plate from the reader's exported file

  As a researcher whose plate reader writes files
  I want to load the export directly
  So that the absorbances reach the curve without passing through a keyboard

  Acceptance criteria:
    AC1  An imported CSV parses to the same values as the same text pasted.
    AC2  A UTF-8 byte order mark is stripped, so the first cell is a number.
    AC3  Text that is not UTF-8 falls back to cp1252 rather than failing.
    AC4  A binary upload is named as its format, never decoded into mojibake.
    AC5  Nothing throws; an unusable file is an issue with advice attached.
    AC6  The load routes are offered in order of transcription risk, upload first.

  # AC1 — import and paste are one code path, so they cannot disagree
  Scenario: An imported CSV parses to the same plate as the same text pasted
    Given a comma separated 8x12 grid as a file
    When the file is imported
    Then the plate is 8 rows by 12 columns
    And the values match parsing the same text as a paste
    And the plate reports no issues

  # AC2 — what Excel writes when you choose "CSV UTF-8"
  Scenario: A byte order mark is stripped rather than parsed as a cell
    Given a comma separated 8x12 grid as a file with a UTF-8 byte order mark
    When the file is imported
    Then well "A1" holds a number
    And the plate reports no issues

  # AC3 — older reader software on Windows. The degree sign is the tell: it is a byte that is
  # not valid UTF-8, so a file carrying one either decodes through the fallback or does not
  # decode at all, and the cell it lands in is where the difference is visible.
  Scenario: A cp1252 encoded export is decoded rather than refused
    Given a comma separated 8x12 grid encoded as cp1252 whose well "C5" reads "25°C"
    When the file is imported
    Then the plate is 8 rows by 12 columns
    And the message shows the degree sign rather than mojibake

  # AC1 — tab separated is the other thing readers write
  Scenario: A tab separated export imports as readily as a comma separated one
    Given a tab separated 8x12 grid as a file
    When the file is imported
    Then the plate is 8 rows by 12 columns
    And the plate reports no issues

  # AC6 — left to right is read as a recommendation whether or not one is meant
  Scenario: The load routes are ordered with the lowest transcription risk first
    Given the plate loading panel
    When its routes are listed
    Then the routes read "Upload", "Type", "Paste" in that order
    And "Upload" is the route that opens

  # AC4 — the file a researcher actually drags in by mistake
  @negative
  Scenario Outline: A binary upload is named as its format with advice attached
    Given a file whose first bytes are those of <format>
    When the file is imported
    Then the import is flagged at error severity naming "<named>"
    And the advice says to export the plate as CSV
    And the plate holds no values

    Examples:
      | format          | named           |
      | an xlsx workbook| zipped workbook |
      | a legacy xls    | Excel workbook  |
      | a PDF           | PDF             |
      | a PNG image     | image           |
      | a JPEG image    | image           |

  # Empty
  @negative
  Scenario: An empty file is refused without producing a grid
    Given a file of zero bytes
    When the file is imported
    Then the import is flagged "EMPTY_INPUT" at error severity
    And the plate holds no values

  # AC5 — undecodable bytes that are not a recognised format. cp1252 maps every byte to some
  # character, so bytes that are not a plate still decode to *something*; what must not happen is
  # that the something looks like a reading. One error and not one number is the guarantee.
  @negative
  Scenario: A file of undecodable bytes is refused rather than turned into mojibake
    Given a file of random bytes that decode to no readable number
    When the file is imported
    Then the import is flagged at error severity
    And every well is empty

  # AC5 — a real CSV whose contents are wrong is still a parse problem, not an import one
  @negative
  Scenario: A CSV of ragged rows reports the ragged row, not an import failure
    Given a comma separated file whose rows hold 12, 11 and 12 cells
    When the file is imported
    Then the plate is flagged "RAGGED_ROWS" at error severity naming row 2

  # AC5 — the property the drop target depends on
  @negative
  Scenario: Importing hostile bytes returns issues rather than throwing
    Given a file of null bytes, lone surrogates and very long lines
    When the file is imported
    Then the import is flagged at error severity
    And no exception escapes the importer
