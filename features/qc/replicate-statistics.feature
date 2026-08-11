# Ported from BCA_quarto features/F04-replicate-qc.feature.md (specdoc §3.5).
#
# The reference workbook computes AVERAGE and nothing else. A replicate pair differing by 30%
# is indistinguishable from a tight one, and the mean of the loose pair is reported with the
# same confidence as the mean of the tight one. This is the layer that tells them apart.
#
# Every threshold here is exclusive at the boundary. A CV of exactly 15% does not warn: a rule
# that fires at its own boundary makes the printed threshold a lie by one increment, and that
# is the kind of detail a researcher checks once and then trusts forever.

@qc
Feature: Replicate statistics and their quality flags

  As a researcher reading a result off a plate
  I want the spread of the replicates behind every mean
  So that a loose pair is visibly different from a tight one

  Acceptance criteria:
    AC1  Mean and standard deviation are the ordinary sample statistics, to 1e-12.
    AC2  Empty replicates are excluded before the count is taken.
    AC3  No input reaches a division by zero, including replicates that are all zero.
    AC4  Thresholds are exclusive: a CV of exactly 15% does not warn.
    AC5  A hard failure replaces the soft warning rather than joining it.
    AC6  Undefined statistics are reported as absent, never as zero.

  # AC1 — the ordinary case
  Scenario Outline: Replicates report their count, mean and spread
    Given the replicates <values>
    When the replicate statistics are computed
    Then the count is <n>
    And the mean is <mean>
    And the coefficient of variation is <cv> percent

    Examples:
      | values             | n | mean  | cv     |
      | 0.500, 0.510       | 2 | 0.505 | 1.4002 |
      | 0.43, 0.44, 0.45   | 3 | 0.44  | 2.2727 |

  # AC1 — agreement with the standard definitions on a longer, less tidy set
  Scenario: Mean and standard deviation match the ordinary sample statistics
    Given ten arbitrary replicate values
    When the replicate statistics are computed
    Then the mean and standard deviation match the sample statistics of those values

  # AC2 — the plate has empty wells in it and they are not zeroes
  Scenario: Empty replicates are excluded before anything is counted
    Given the replicates 0.5, empty, 0.52, empty
    When the replicate statistics are computed
    Then the count is 2
    And the mean is 0.51

  # AC4 — the boundary, from below
  Scenario: A coefficient of variation of exactly 15 percent does not warn
    Given replicates whose coefficient of variation is exactly 15 percent
    When the replicate statistics are computed
    Then no quality flag is raised

  # AC6 — the workbook's own blank row, which has one reading in it
  @negative
  Scenario: A single replicate reports no spread and says why
    Given the replicates 0.132
    When the replicate statistics are computed
    Then the standard deviation is absent
    And the coefficient of variation is absent
    And the statistics are flagged "SINGLE_REPLICATE" at info severity

  # Empty — both ways of having nothing
  @negative
  Scenario Outline: Replicates with nothing readable in them report no data
    Given the replicates <values>
    When the replicate statistics are computed
    Then the count is 0
    And the mean is absent
    And the statistics are flagged "NO_DATA" at info severity

    Examples:
      | values             |
      | nothing            |
      | empty, empty, empty|

  # AC5 — the warn band and the fail band, and that they do not overlap
  @negative
  Scenario Outline: A loose replicate pair is flagged at the severity its spread earns
    Given the replicates <values>
    When the replicate statistics are computed
    Then the statistics are flagged "<code>" at <severity> severity
    And no other quality flag is raised

    Examples:
      | values      | code    | severity |
      | 0.40, 0.55  | CV_WARN | warn     |
      | 0.20, 0.60  | CV_FAIL | error    |

  # AC3 — a mean of zero is the division the workbook would have taken
  @negative
  Scenario: Replicates that are all zero report no variation rather than dividing by it
    Given the replicates 0.0, 0.0, 0.0
    When the replicate statistics are computed
    Then the mean is 0
    And the standard deviation is 0
    And the coefficient of variation is absent

  # AC3 — a mean of zero reached from both sides
  @negative
  Scenario: Replicates straddling zero report no coefficient of variation
    Given the replicates -0.01, 0.01
    When the replicate statistics are computed
    Then the mean is 0
    And the coefficient of variation is absent

  # Malformed — a NaN that arrived from a parsed cell
  @negative
  Scenario: A non-finite replicate is excluded like an empty well and recorded
    Given the replicates 0.5, NaN
    When the replicate statistics are computed
    Then the count is 1
    And the statistics are flagged "NON_NUMERIC_INPUT" at warn severity
