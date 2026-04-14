Feature: Order Management System (OMS)
  As an order manager
  I want to create, route, and manage orders
  So that trades are executed efficiently through the right venue

  Background:
    Given the trading system is running

  Scenario: Create a small limit order routed to SMART_ORDER_ROUTER
    Given I have an order request:
      | symbol | quantity | price  | side | orderType | timeInForce |
      | TSLA   | 10       | 250.00 | BUY  | LIMIT     | DAY         |
    When I submit the order
    Then the response status code is 200
    And the order has a valid order ID
    And the order routing is "SMART_ORDER_ROUTER"

  Scenario: Create a large block order routed to DARK_POOL
    Given I have an order request:
      | symbol | quantity | price   | side | orderType | timeInForce |
      | AMZN   | 2000     | 300.00  | BUY  | LIMIT     | GTC         |
    When I submit the order
    Then the response status code is 200
    And the order routing is "DARK_POOL"

  Scenario: Create a large quantity order routed to ALGO_ENGINE
    Given I have an order request:
      | symbol | quantity | price  | side | orderType | timeInForce |
      | SPY    | 6000     | 50.00  | SELL | LIMIT     | DAY         |
    When I submit the order
    Then the response status code is 200
    And the order routing contains "ALGO_ENGINE"

  Scenario: Create a market order routed to DMA
    Given I have an order request:
      | symbol | quantity | price | side | orderType | timeInForce |
      | NVDA   | 100      | 0.0   | BUY  | MARKET    | IOC         |
    When I submit the order
    Then the response status code is 200
    And the order routing is "DMA"

  Scenario: Reject order with missing symbol
    Given I have an order request with no symbol:
      | quantity | price  | side | orderType |
      | 100      | 150.00 | BUY  | LIMIT     |
    When I submit the order
    Then the response status code is 400

  Scenario: Cancel a pending order
    Given I have submitted an order for "GOOG" with quantity 5 at price 170.00
    When I cancel the order by its ID
    Then the response status code is 200
    And the order status is "CANCELLED"

  Scenario: Retrieve all orders
    Given at least one order has been created
    When I request all orders
    Then the response status code is 200
    And the orders list is not empty
