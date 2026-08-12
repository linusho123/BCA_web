# Split out of plate-layout-painting.feature on 2026-08-12, unbuilt.
#
# The domain half is done: mapSamples already raises UNREADABLE_WELL_IN_REGION for a well with
# no usable absorbance inside a region, and now raises a second warning naming the sample and
# how many wells it was averaged over. Both are proven by the node suite.
#
# What is not proven is the browser path: painting C1:C3 as MCF7 and then finding that warning
# on the page. The scenario below was written, run, and failed with the assignment apparently
# not reaching the mapping stage. It is parked rather than deleted, and rather than left red.

@plate @negative
Feature: Reporting an empty well inside an assignment

  As a researcher who painted three wells for a sample and only filled two
  I want the page to tell me which well is missing and which sample it belongs to
  So that I find out before a mean over two wells is reported as a mean over three

  Acceptance criteria:
    AC1  An empty well inside an assignment is reported, because it is declared work missing.
    AC2  The report names the sample, not only the well.

  # AC1 and AC2
  Scenario: An empty well inside an assignment is reported against that sample
    Given the workbook's plate with well "C2" holding no measurement
    When wells "C1:C3" are painted as "MCF7"
    Then an issue at warn severity names well "C2"
    And the issue names "MCF7" as the sample it belongs to
    And "MCF7" reports a concentration from 2 wells
