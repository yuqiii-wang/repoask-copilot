Feature: Risk Management API
  As a risk officer
  I want to perform pre-trade risk checks and portfolio assessments
  So that trading positions remain within approved limits

  Background:
    Given the trading system is running

  Scenario: Approve a small pre-trade risk check
    Given I have a risk check request:
      | tradeId   | tradeType | tradeValue | counterparty | positionSize | price  | quantity |
      | TRD-00001 | EQUITY    | 10000.00   | BROKER-A     | 5000.00      | 100.00 | 100      |
    When I submit the risk check
    Then the response status code is 200
    And the risk check result is approved
    And the trade ID in response is "TRD-00001"

  Scenario: Reject a trade exceeding position limits
    Given I have a risk check request:
      | tradeId   | tradeType | tradeValue  | counterparty | positionSize  | price    | quantity |
      | TRD-99999 | EQUITY    | 5000000.00  | BROKER-X     | 2000000.00    | 500.00   | 10000    |
    When I submit the risk check
    Then the response status code is 200
    And the risk check result is rejected
    And the rejection reason is provided

  Scenario: Perform a portfolio VaR assessment
    Given I have a risk assessment request:
      | portfolioId | portfolioValue | riskModel | confidenceLevel | timeHorizon |
      | PORT-001    | 1000000.00     | HISTORICAL| 0.99            | 1           |
    When I submit the risk assessment
    Then the response status code is 200
    And the assessment has a valid assessment ID
    And the VaR 99 value is provided
    And the VaR 95 value is provided

  Scenario: Retrieve all risk assessments
    Given at least one risk assessment has been performed
    When I request all risk assessments
    Then the response status code is 200
    And the risk assessments list is not empty
