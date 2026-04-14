Feature: Equity Trading API
  As a trader
  I want to submit and manage equity trades
  So that I can execute buy and sell orders on stock exchanges

  Background:
    Given the trading system is running

  Scenario: Successfully execute a BUY equity trade
    Given I have an equity trade request:
      | symbol   | quantity | price   | side | exchange | orderType | timeInForce |
      | AAPL     | 100      | 195.50  | BUY  | NASDAQ   | LIMIT     | DAY         |
    When I submit the equity trade
    Then the response status code is 200
    And the trade status is "EXECUTED"
    And the trade has a valid trade ID
    And the trade symbol is "AAPL"

  Scenario: Successfully execute a SELL equity trade
    Given I have an equity trade request:
      | symbol | quantity | price  | side | exchange | orderType | timeInForce |
      | MSFT   | 50       | 420.00 | SELL | NASDAQ   | MARKET    | IOC         |
    When I submit the equity trade
    Then the response status code is 200
    And the trade status is "EXECUTED"
    And the trade side is "SELL"

  Scenario: Retrieve all equity trades
    Given at least one equity trade has been executed
    When I request all equity trades
    Then the response status code is 200
    And the response contains a list of trades

  Scenario: Retrieve an equity trade by ID
    Given I have executed an equity trade for "GOOGL" with quantity 25 at price 175.00
    When I request the trade by its ID
    Then the response status code is 200
    And the returned trade symbol is "GOOGL"
    And the returned trade quantity is 25
