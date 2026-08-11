# Split out of analysis-workflow.feature, which had grown two subjects.
#
# That file is about a plate moving through the stages. This one is about the sessions that have
# no plate in them yet — the first visit, and every return visit after one. They share a page and
# nothing else: the scenarios here are all about what is on the screen when the pipeline has
# nothing to compute, which is the state a person is actually in when they arrive.
#
# The split is also what keeps both files under the 12-scenario cap in .gherkin-lintrc. That cap
# is a real constraint, not a formality — a feature file that needs raising it has usually
# stopped being about one thing.

@analysis
Feature: Returning to a session

  As a researcher who closed the tab and came back
  I want my layout and settings to still be there and the page to tell me what it needs
  So that I can pick up where I left off without re-deriving what I already set up

  Acceptance criteria:
    AC1  The layout and the settings survive a reload; the plate deliberately does not.
    AC2  A session with no plate shows what to do, not a list of what is missing.
    AC3  A restored layout is a session in progress, not a session in error.

  Background:
    Given the analysis page with the workbook's plate loaded

  # AC1 — the session survives a reload, because a browser tab is not a safe place to think
  Scenario: The layout and settings are restored after a reload
    Given the default layout applied with the names "MCF7" and "RPMI8226"
    When the page is reloaded
    Then the sample names and their wells are restored
    And the blank subtraction setting is restored

  # AC2 — a session with nothing in it must not look like a broken one
  @negative
  Scenario: An empty session shows what to do rather than a wall of issues
    Given a session with no plate loaded
    When the analysis page is shown
    Then the issue panel is empty
    And the page states that a plate is needed to begin

  # AC3 — the case AC1 and AC2 do not reach separately.
  #
  # The layout persists and the plate deliberately does not, so this is what every returning
  # visitor loads: assignments pointing at wells of a plate that is not there. Read as "work in
  # progress" it is a wall of errors — one per mapped well, all saying the plate is 0x0 — in
  # front of a person who has done nothing wrong yet and cannot act on any of them.
  @negative
  Scenario: A restored layout with no plate asks for the plate rather than reporting it missing
    Given the default layout applied with the names "MCF7" and "RPMI8226"
    When the page is reloaded
    Then the sample names and their wells are restored
    And the issue panel is empty
    And the page states that a plate is needed to begin
