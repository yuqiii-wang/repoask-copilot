Feature: Ledger and Accounting
  As a finance operations team member
  I want to create journal entries and generate reports
  So that I can track P&L and net asset value accurately

  Background:
    Given the trading system is running

  Scenario: Create a balanced journal entry for a trade
    When I create a journal entry:
      | tradeId   | account       | debit    | credit   | currency | description                | entryType |
      | TRD-10001 | EQUITY_DESK   | 5000.00  | 5000.00  | USD      | AAPL equity purchase       | TRADE     |
    Then the response status code is 200
    And the journal entry has a valid entry ID
    And the journal entry is stored

  Scenario: Create a settlement journal entry
    When I create a journal entry:
      | tradeId   | account       | debit    | credit   | currency | description                | entryType  |
      | TRD-10002 | SETTLEMENT    | 12500.00 | 12500.00 | USD      | Bond settlement DTC        | SETTLEMENT |
    Then the response status code is 200
    And the journal entry has a valid entry ID

  Scenario: Create an imbalanced journal entry (error case)
    When I create a journal entry:
      | tradeId   | account       | debit    | credit   | currency | description                | entryType |
      | TRD-10003 | FEE_ACCOUNT   | 1000.00  | 950.00   | USD      | Commission mismatch        | FEE       |
    Then the response status code is 200
    And the journal entry has a valid entry ID

  Scenario: Retrieve all journal entries
    Given at least one journal entry has been created
    When I request all journal entries
    Then the response status code is 200
    And the response contains a list of journal entries

  Scenario: Retrieve journal entries by trade ID
    Given I have created a journal entry for trade "TRD-LEDGER1"
    When I request journal entries for trade "TRD-LEDGER1"
    Then the response status code is 200
    And the journal entry list contains trade "TRD-LEDGER1"

  Scenario: Generate PnL report for current month
    When I request a PnL report for period "2026-04"
    Then the response status code is 200
    And the PnL report has a valid report ID
    And the PnL report total PnL is greater than zero

  Scenario: Calculate Net Asset Value
    When I request the NAV report
    Then the response status code is 200
    And the NAV report has a valid report ID
    And the NAV per share is greater than zero
