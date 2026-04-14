Feature: Settlement Processing
  As a settlement operations team member
  I want to create and process trade settlements
  So that trades are settled correctly via the appropriate settlement method

  Background:
    Given the trading system is running

  Scenario: Create a new settlement instruction
    When I create a settlement with:
      | tradeId   | isin         | settlementAmount | currency | counterparty | settlementMethod | settlementDate |
      | TRD-00001 | US0378331005 | 10000.00         | USD      | GOLDMAN_SACHS | DTC             | 2026-04-15     |
    Then the response status code is 200
    And the settlement has a valid settlement ID
    And the settlement status is "PENDING"

  Scenario: Create and process a settlement successfully
    When I create a settlement with:
      | tradeId   | isin         | settlementAmount | currency | counterparty | settlementMethod | settlementDate |
      | TRD-00002 | US5949181045 | 25000.00         | USD      | JP_MORGAN    | NSCC             | 2026-04-15     |
    And I process the settlement
    Then the response status code is 200
    And the settlement status is processed or failed

  Scenario: Settlement fails if ISIN is invalid
    When I create a settlement with:
      | tradeId   | isin    | settlementAmount | currency | counterparty | settlementMethod | settlementDate |
      | TRD-00003 | INVALID | 5000.00          | USD      | CITI         | SWIFT            | 2026-04-15     |
    And I process the settlement
    Then the response status code is 200
    And the settlement status is "FAILED"

  Scenario: Retrieve all settlements
    When I create a settlement with:
      | tradeId   | isin         | settlementAmount | currency | counterparty | settlementMethod | settlementDate |
      | TRD-00004 | US4592001014 | 15000.00         | USD      | BARCLAYS     | DTC              | 2026-04-16     |
    And I request all settlements
    Then the response status code is 200
    And the response contains a list of settlements

  Scenario: Retrieve settlements by trade ID
    When I create a settlement with:
      | tradeId   | isin         | settlementAmount | currency | counterparty | settlementMethod | settlementDate |
      | TRD-LINK1 | US88160R1014 | 8000.00          | USD      | UBS          | SWIFT            | 2026-04-17     |
    And I request settlements for trade "TRD-LINK1"
    Then the response status code is 200
    And the settlement list contains trade "TRD-LINK1"
