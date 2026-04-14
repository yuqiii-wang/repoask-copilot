Feature: Market Data API
  As a trader
  I want to retrieve real-time market data quotes
  So that I can make informed trading decisions

  Background:
    Given the trading system is running

  Scenario: Get market data for a single symbol
    When I request market data for symbol "AAPL"
    Then the response status code is 200
    And the market data symbol is "AAPL"
    And the market data has a bid price
    And the market data has an ask price
    And the market data has a last price
    And the ask price is greater than or equal to the bid price

  Scenario: Get market data for multiple symbols
    When I request market data for symbols "AAPL,MSFT,GOOGL"
    Then the response status code is 200
    And the market data response contains 3 entries

  Scenario: Get market data for a bond-like symbol
    When I request market data for symbol "US10Y"
    Then the response status code is 200
    And the market data symbol is "US10Y"
    And the market data has a last price
