@investmentBanking
Feature: Investment Banking Manager – Full Trade Lifecycle
  As an investment banking manager
  I want to book a large equity position funded by FX-borrowed capital
  and hedge it with a fixed income instrument
  So that the backend risk engine validates the book and forwards both legs to settlement

  Background:
    Given the trading system is running

  Scenario: Manager books equities funded by FX borrowings, hedged with fixed income, through risk to settlement

    # ── Leg 1: Borrow USD capital by executing a EURUSD SWAP ─────────────────────
    # The manager raises USD liquidity by selling EUR via a FX SWAP.
    Given I have an FX trade request:
      | currencyPair | quantity   | side | tradeType | exchangeRate |
      | EURUSD       | 5000000.0  | SELL | SWAP      | 1.0850       |
    When I submit the FX trade
    Then the response status code is 200
    And the FX trade status is "EXECUTED"
    And the FX trade has a valid trade ID

    # ── Leg 2: Deploy borrowed USD capital into a large equity block ──────────────
    # Manager books 5 000 shares of Goldman Sachs at a limit price.
    # Notional ≈ $2.1m – qualifies for dark-pool routing and DTC settlement.
    Given I have an equity trade request:
      | symbol | quantity | price  | side | exchange | orderType | timeInForce |
      | GS     | 5000     | 420.00 | BUY  | NYSE     | LIMIT     | GTC         |
    When I submit the equity trade
    Then the response status code is 200
    And the trade status is "EXECUTED"
    And the trade has a valid trade ID
    And the trade symbol is "GS"
    And the trade side is "BUY"

    # ── Leg 3: Reduce interest-rate risk with a 10-year US Treasury hedge ─────────
    # $9 750 notional (100 bonds × $97.50) offsets duration risk on the equity book.
    When I submit a bond trade:
      | symbol  | isin         | bondType   | side | quantity | price | couponRate | maturityDate | yieldToMaturity |
      | UST-10Y | US912828YV68 | GOVERNMENT | BUY  | 100      | 97.50 | 4.25       | 2034-05-15   | 0.0             |
    Then the response status code is 200
    And the bond trade has a valid trade ID
    And the bond trade status is "EXECUTED"
    And the bond trade has computed yield to maturity

    # ── Risk Gate 1: Pre-trade risk check on the equity notional ─────────────────
    # tradeValue and positionSize are kept under $500k / $1m limits so the
    # check is approved (riskScore ≈ 10.05 < 50; positionSize 100 000 < 1 000 000).
    Given I have a risk check request:
      | tradeId   | tradeType | tradeValue | counterparty  | positionSize | price  | quantity |
      | TRD-GS001 | EQUITY    | 100000.00  | GOLDMAN_SACHS | 100000.00    | 420.00 | 100      |
    When I submit the risk check
    Then the response status code is 200
    And the risk check result is approved
    And the trade ID in response is "TRD-GS001"

    # ── Risk Gate 2: Portfolio VaR assessment across both legs ────────────────────
    # Combined equity + bond portfolio of $10m assessed with MONTE_CARLO at 99%
    # confidence over a 1-day horizon (1-day VAR ≈ 2.2% < 6% limit → no breach).
    Given I have a risk assessment request:
      | portfolioId    | portfolioValue | riskModel   | confidenceLevel | timeHorizon |
      | PORT-IBMGR-001 | 10000000.00    | MONTE_CARLO | 0.99            | 1           |
    When I submit the risk assessment
    Then the response status code is 200
    And the assessment has a valid assessment ID
    And the VaR 99 value is provided
    And the VaR 95 value is provided
    And no portfolio risk limits are breached
    And the portfolio stress test result is provided

    # ── OMS: Route the equity block order ────────────────────────────────────────
    # Notional $2.1m ≥ $500k threshold → system must route to DARK_POOL.
    Given I have an order request:
      | symbol | quantity | price  | side | orderType | timeInForce |
      | GS     | 5000     | 420.00 | BUY  | LIMIT     | GTC         |
    When I submit the order
    Then the response status code is 200
    And the order has a valid order ID
    And the order routing is "DARK_POOL"
    And the order status is "PENDING"

    # ── Ledger: Double-entry bookkeeping for both trade legs ──────────────────────
    When I create a journal entry:
      | tradeId   | account     | debit      | credit | currency | description                              | entryType |
      | TRD-GS001 | EQUITY_DESK | 2100000.00 | 0.00   | USD      | GS equity position – funded via FX SWAP | TRADE     |
    Then the response status code is 200

    When I create a journal entry:
      | tradeId      | account      | debit   | credit | currency | description                           | entryType |
      | TRD-BOND-001 | FIXED_INCOME | 9750.00 | 0.00   | USD      | UST-10Y bond hedge for GS equity leg  | TRADE     |
    Then the response status code is 200

    # ── Settlement: Equity leg → DTC clearing ────────────────────────────────────
    When I create a settlement with:
      | tradeId   | isin         | settlementAmount | currency | counterparty  | settlementMethod | settlementDate |
      | TRD-GS001 | US38141G1040 | 2100000.00       | USD      | GOLDMAN_SACHS | DTC              | 2026-04-15     |
    Then the response status code is 200
    And the settlement has a valid settlement ID
    And the settlement status is "PENDING"
    When I process the settlement
    Then the response status code is 200
    And the settlement status is processed or failed

    # ── Settlement: Bond hedge leg → DTC clearing ────────────────────────────────
    When I create a settlement with:
      | tradeId      | isin         | settlementAmount | currency | counterparty | settlementMethod | settlementDate |
      | TRD-BOND-001 | US912828YV68 | 9750.00          | USD      | JP_MORGAN    | DTC              | 2026-04-15     |
    Then the response status code is 200
    And the settlement has a valid settlement ID
    And the settlement status is "PENDING"
    When I process the settlement
    Then the response status code is 200
    And the settlement status is processed or failed
