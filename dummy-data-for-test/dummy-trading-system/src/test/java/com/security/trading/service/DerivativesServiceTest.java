package com.security.trading.service;


import com.security.trading.service.impl.DerivativesServiceImpl;
import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;
import com.security.trading.service.impl.*;

import com.security.trading.service.DerivativesService;
import com.security.trading.model.dto.OptionPriceRequest;
import com.security.trading.model.dto.OptionPriceResult;
import com.security.trading.model.entity.OptionTrade;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class DerivativesServiceTest {

    private DerivativesServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new DerivativesServiceImpl();
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private OptionTrade buildTrade(String type, String underlying, double strike,
                                   double iv, double price, int qty, double delta) {
        OptionTrade t = new OptionTrade();
        t.setOptionType(type);
        t.setUnderlying(underlying);
        t.setStrikePrice(strike);
        t.setImpliedVolatility(iv);
        t.setPrice(price);
        t.setQuantity(qty);
        t.setSide("BUY");
        t.setOptionStyle("EUROPEAN");
        t.setExpirationDate(LocalDate.now().plusMonths(6).toString());
        t.setDelta(delta);
        return t;
    }

    private OptionPriceRequest buildRequest(String type, double S, double K,
                                             double sigma, double r) {
        OptionPriceRequest req = new OptionPriceRequest();
        req.setOptionType(type);
        req.setUnderlying("AAPL");
        req.setUnderlyingPrice(S);
        req.setStrikePrice(K);
        req.setImpliedVolatility(sigma);
        req.setRiskFreeRate(r);
        req.setExpirationDate(LocalDate.now().plusYears(1).toString());
        req.setOptionStyle("EUROPEAN");
        return req;
    }

    // ── executeTrade ─────────────────────────────────────────────────────────

    @Test
    void executeTrade_callWithZeroDelta_calculatesGreeks() {
        OptionTrade trade = buildTrade("CALL", "AAPL", 180.0, 0.25, 175.0, 10, 0.0);
        OptionTrade result = service.executeTrade(trade);

        assertThat(result.getStatus()).isEqualTo("EXECUTED");
        assertThat(result.getDelta()).isBetween(0.0, 1.0); // CALL delta ∈ [0, 1]
        assertThat(result.getGamma()).isGreaterThan(0.0);
        assertThat(result.getVega()).isGreaterThan(0.0);
        assertThat(result.getFilledQuantity()).isEqualTo(10);
    }

    @Test
    void executeTrade_putWithZeroDelta_calculatesGreeks() {
        OptionTrade trade = buildTrade("PUT", "AAPL", 180.0, 0.25, 175.0, 5, 0.0);
        OptionTrade result = service.executeTrade(trade);

        assertThat(result.getStatus()).isEqualTo("EXECUTED");
        assertThat(result.getDelta()).isBetween(-1.0, 0.0); // PUT delta ∈ [-1, 0]
        assertThat(result.getGamma()).isGreaterThan(0.0);
        assertThat(result.getRho()).isLessThan(0.0); // PUT rho < 0
    }

    @Test
    void executeTrade_withExistingDelta_skipsGreekCalculation() {
        OptionTrade trade = buildTrade("CALL", "TSLA", 250.0, 0.30, 248.0, 3, 0.55);
        OptionTrade result = service.executeTrade(trade);

        assertThat(result.getStatus()).isEqualTo("EXECUTED");
        // delta unchanged (calculateGreeks was NOT called)
        assertThat(result.getDelta()).isEqualTo(0.55);
    }

    @Test
    void executeTrade_generatesTradeId() {
        OptionTrade trade = buildTrade("CALL", "MSFT", 300.0, 0.20, 298.0, 2, 0.0);
        OptionTrade result = service.executeTrade(trade);

        assertThat(result.getTradeId()).startsWith("OPT-");
    }

    @Test
    void executeTrade_keepsExistingTradeId() {
        OptionTrade trade = buildTrade("CALL", "GOOG", 140.0, 0.22, 139.0, 1, 0.0);
        trade.setTradeId("OPT-2025-CUSTOM");
        OptionTrade result = service.executeTrade(trade);

        assertThat(result.getTradeId()).isEqualTo("OPT-2025-CUSTOM");
    }

    @Test
    void executeTrade_zeroPriceUsesStrikeFallback() {
        // price=0 → S = strikePrice * 1.02 in calculateGreeks
        OptionTrade trade = buildTrade("CALL", "NVDA", 500.0, 0.35, 0.0, 4, 0.0);
        OptionTrade result = service.executeTrade(trade);

        assertThat(result.getStatus()).isEqualTo("EXECUTED");
        assertThat(result.getDelta()).isBetween(0.0, 1.0);
    }

    @Test
    void executeTrade_zeroIvUses20PercentFallback() {
        // iv=0 → sigma = 0.20 fallback in calculateGreeks
        OptionTrade trade = buildTrade("PUT", "AMD", 100.0, 0.0, 98.0, 5, 0.0);
        OptionTrade result = service.executeTrade(trade);

        assertThat(result.getStatus()).isEqualTo("EXECUTED");
        assertThat(result.getDelta()).isBetween(-1.0, 0.0);
    }

    // ── priceOption ──────────────────────────────────────────────────────────

    @Test
    void priceOption_callOption_returnsValidResult() {
        OptionPriceRequest req = buildRequest("CALL", 150.0, 155.0, 0.25, 0.045);
        OptionPriceResult result = service.priceOption(req);

        assertThat(result).isNotNull();
        assertThat(result.getOptionPrice()).isGreaterThan(0.0);
        assertThat(result.getDelta()).isBetween(0.0, 1.0);
        assertThat(result.getGamma()).isGreaterThan(0.0);
        assertThat(result.getVega()).isGreaterThan(0.0);
        assertThat(result.getRho()).isGreaterThan(0.0); // CALL rho > 0
    }

    @Test
    void priceOption_putOption_returnsValidResult() {
        OptionPriceRequest req = buildRequest("PUT", 150.0, 155.0, 0.25, 0.045);
        OptionPriceResult result = service.priceOption(req);

        assertThat(result).isNotNull();
        assertThat(result.getOptionPrice()).isGreaterThan(0.0);
        assertThat(result.getDelta()).isBetween(-1.0, 0.0);
        assertThat(result.getRho()).isLessThan(0.0); // PUT rho < 0
    }

    @Test
    void priceOption_negativeUnderlyingPrice_returnsNull() {
        OptionPriceRequest req = buildRequest("CALL", 0.0, 100.0, 0.20, 0.05);
        assertThat(service.priceOption(req)).isNull();
    }

    @Test
    void priceOption_zeroUnderlyingPrice_returnsNull() {
        OptionPriceRequest req = buildRequest("PUT", -5.0, 100.0, 0.20, 0.05);
        assertThat(service.priceOption(req)).isNull();
    }

    @Test
    void priceOption_volatilityTooLow_returnsNull() {
        OptionPriceRequest req = buildRequest("CALL", 100.0, 100.0, 0.005, 0.05);
        assertThat(service.priceOption(req)).isNull();
    }

    @Test
    void priceOption_volatilityTooHigh_returnsNull() {
        OptionPriceRequest req = buildRequest("CALL", 100.0, 100.0, 2.5, 0.05);
        assertThat(service.priceOption(req)).isNull();
    }

    @Test
    void priceOption_volatilityAtLowerBound_returnsResult() {
        // sigma == 0.01 is valid (just on the boundary)
        OptionPriceRequest req = buildRequest("CALL", 100.0, 100.0, 0.01, 0.05);
        assertThat(service.priceOption(req)).isNotNull();
    }

    @Test
    void priceOption_volatilityAtUpperBound_returnsResult() {
        // sigma == 2.0 is valid (boundary)
        OptionPriceRequest req = buildRequest("CALL", 100.0, 100.0, 2.0, 0.05);
        assertThat(service.priceOption(req)).isNotNull();
    }

    @Test
    void priceOption_deepInTheMoney_hasPositiveIntrinsicValue() {
        // CALL deep ITM: S >> K
        OptionPriceRequest req = buildRequest("CALL", 200.0, 100.0, 0.20, 0.05);
        OptionPriceResult result = service.priceOption(req);

        assertThat(result).isNotNull();
        assertThat(result.getIntrinsicValue()).isGreaterThan(0.0);
    }

    // ── query methods ────────────────────────────────────────────────────────

    @Test
    void getTrades_returnsAllExecutedTrades() {
        service.executeTrade(buildTrade("CALL", "AAPL", 180.0, 0.25, 175.0, 1, 0.5));
        service.executeTrade(buildTrade("PUT", "MSFT", 300.0, 0.22, 295.0, 2, -0.40));

        List<OptionTrade> trades = service.getTrades();
        assertThat(trades).hasSize(2);
    }

    @Test
    void getTrade_byId_returnsCorrectTrade() {
        OptionTrade t = buildTrade("CALL", "AAPL", 180.0, 0.25, 175.0, 1, 0.5);
        t.setTradeId("OPT-TEST-001");
        service.executeTrade(t);

        OptionTrade found = service.getTrade("OPT-TEST-001");
        assertThat(found).isNotNull();
        assertThat(found.getUnderlying()).isEqualTo("AAPL");
    }

    @Test
    void getTrade_unknownId_returnsNull() {
        assertThat(service.getTrade("NONEXISTENT")).isNull();
    }
}
