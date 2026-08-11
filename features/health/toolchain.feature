Feature: Toolchain health

  As a developer working on this project
  I want a scenario that exercises the whole ABDD loop
  So that I can tell a broken setup apart from a broken feature

  Acceptance criteria:
    AC1  The acceptance project discovers and runs .feature files.
    AC2  Step definitions registered in features/steps are found.
    AC3  Cucumber Expression parameters reach steps in the right order.

  @smoke
  Scenario: Numbers passed through step parameters add up
    Given a number 1
    And another number 2
    And another number 3
    Then the sum should be 6

  @negative
  Scenario: A wrong expected sum fails the scenario
    Given a number 1
    And another number 2
    Then the sum should not be 4
