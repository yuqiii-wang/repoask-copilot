Feature: Fixed Income Trading
  As a fixed income trader
  I want to execute bond trades and calculate bond metrics
  So that I can manage bond positions accurately

  Background:
    Given the trading system is running

  Scenario: Execute a corporate bond BUY trade
    When I submit a bond trade:
      | symbol | isin         | bondType  | side | quantity | price  | couponRate | maturityDate | yieldToMaturity |
      | XOM-10 | US30231G1022 | CORPORATE | BUY  | 100      | 98.50  | 3.5        | 2031-04-15   | 0.0            |
    Then the response status code is 200
    And the bond trade has a valid trade ID
    And the bond trade status is "EXECUTED"
    And the bond trade has computed yield to maturity

  Scenario: Execute a government bond BUY trade
    When I submit a bond trade:
      | symbol  | isin         | bondType   | side | quantity | price  | couponRate | maturityDate | yieldToMaturity |
      | UST-10Y | US912828YV68 | GOVERNMENT | BUY  | 50       | 99.75  | 2.875      | 2036-05-15   | 0.0            |
    Then the response status code is 200
    And the bond trade has a valid trade ID
    And the bond trade status is "EXECUTED"

  Scenario: Execute a municipal bond SELL trade
    When I submit a bond trade:
      | symbol | isin         | bondType  | side | quantity | price  | couponRate | maturityDate | yieldToMaturity |
      | NYC-MU | US64971QZ345 | MUNICIPAL | SELL | 25       | 101.20 | 4.0        | 2030-09-01   | 3.8            |
    Then the response status code is 200
    And the bond trade status is "EXECUTED"

  Scenario: Calculate bond metrics (YTM, duration, convexity)
    When I request bond metrics:
      | isin         | faceValue | couponRate | maturityDate | marketPrice | maturityYears | settlementDate |
      | US30231G1022 | 100.00    | 3.5        | 2031-04-15   | 98.50       | 5             | 2026-04-15     |
    Then the response status code is 200
    And the bond metrics include yield to maturity
    And the bond metrics include duration
    And the bond metrics include convexity

  Scenario: Retrieve all bond trades
    Given at least one bond trade has been executed
    When I request all bond trades
    Then the response status code is 200
    And the response contains a list of bond trades

  Scenario: Retrieve bond trade by ID
    Given I have executed a bond trade for "US30231G1022" with quantity 10 at price 97.50
    When I request the bond trade by its ID
    Then the response status code is 200
    And the returned bond ISIN is "US30231G1022"
