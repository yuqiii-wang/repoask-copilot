Feature: FX Trading API
  As an FX dealer
  I want to execute foreign exchange trades and retrieve rates
  So that I can trade currency pairs at market rates

  Background:
    Given the trading system is running

  Scenario: Execute a EURUSD buy trade with T+2 settlement
    Given I have an FX trade request:
      | currencyPair | quantity  | side | tradeType | exchangeRate |
      | EURUSD       | 100000    | BUY  | SPOT      | 1.0834       |
    When I submit the FX trade
    Then the response status code is 200
    And the FX trade status is "EXECUTED"
    And the FX trade has a valid trade ID
    And the currency pair is "EURUSD"

  Scenario: Execute a GBPUSD sell trade
    Given I have an FX trade request:
      | currencyPair | quantity | side | tradeType | exchangeRate |
      | GBPUSD       | 50000    | SELL | SPOT      | 1.2613       |
    When I submit the FX trade
    Then the response status code is 200
    And the FX trade status is "EXECUTED"

  Scenario: Retrieve EURUSD exchange rate
    When I request the exchange rate for "EURUSD"
    Then the response status code is 200
    And the rate has a bid price
    And the rate has an ask price
    And the ask price is greater than the bid price

  Scenario: Retrieve USDJPY exchange rate
    When I request the exchange rate for "USDJPY"
    Then the response status code is 200
    And the currency pair returned is "USDJPY"

  Scenario: Retrieve all FX trades
    Given at least one FX trade has been executed
    When I request all FX trades
    Then the response status code is 200
    And the FX trades list is not empty
