package com.security.trading.service;


import com.security.trading.service.impl.FixedIncomeServiceImpl;
import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;
import com.security.trading.service.impl.*;

import com.security.trading.model.dto.BondCalculationRequest;
import com.security.trading.model.dto.BondCalculationResult;
import com.security.trading.model.entity.BondTrade;
import com.security.trading.service.FixedIncomeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class FixedIncomeServiceTest {

    private FixedIncomeServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new FixedIncomeServiceImpl();
    }

    @Test
    void executeTrade_generatesIdAndExecutes() {
        BondTrade trade = buildTrade("US0378331005", "CORPORATE", "BUY", 100, 98.5, 3.5, 0.0, 0.0, 0.0);

        BondTrade result = service.executeTrade(trade);

        assertThat(result.getTradeId()).startsWith("FI-");
        assertThat(result.getStatus()).isEqualTo("EXECUTED");
        assertThat(result.getFilledQuantity()).isEqualTo(100);
        assertThat(result.getAveragePrice()).isEqualTo(98.5);
        assertThat(result.getTimestamp()).isNotNull();
    }

    @Test
    void executeTrade_withZeroYtm_computesYtm() {
        BondTrade trade = buildTrade("US5949181045", "GOVERNMENT", "BUY", 50, 99.0, 2.5, 0.0, 0.0, 0.0);

        BondTrade result = service.executeTrade(trade);

        assertThat(result.getYieldToMaturity()).isGreaterThan(0);
    }

    @Test
    void executeTrade_withZeroDuration_computesDuration() {
        BondTrade trade = buildTrade("US30231G1022", "CORPORATE", "BUY", 10, 97.0, 4.0, 3.8, 0.0, 0.0);

        BondTrade result = service.executeTrade(trade);

        assertThat(result.getDuration()).isGreaterThan(0);
    }

    @Test
    void executeTrade_withZeroConvexity_computesConvexity() {
        BondTrade trade = buildTrade("US4592001014", "MUNICIPAL", "SELL", 25, 101.0, 5.0, 4.5, 7.0, 0.0);

        BondTrade result = service.executeTrade(trade);

        assertThat(result.getConvexity()).isGreaterThan(0);
    }

    @Test
    void executeTrade_keepsExistingTradeId() {
        BondTrade trade = buildTrade("US0378331005", "CORPORATE", "BUY", 5, 98.0, 3.0, 0.0, 0.0, 0.0);
        trade.setTradeId("FI-CUSTOM-001");

        BondTrade result = service.executeTrade(trade);

        assertThat(result.getTradeId()).isEqualTo("FI-CUSTOM-001");
    }

    @Test
    void calculateBondMetrics_validIsin_returnsMetrics() {
        BondCalculationRequest req = new BondCalculationRequest();
        req.setIsin("US0378331005");
        req.setFaceValue(100.0);
        req.setCouponRate(3.5);
        req.setMaturityDate("2031-04-15");
        req.setMarketPrice(98.5);
        req.setMaturityYears(5);
        req.setSettlementDate("2026-04-15");

        BondCalculationResult result = service.calculateBondMetrics(req);

        assertThat(result).isNotNull();
        assertThat(result.getIsin()).isEqualTo("US0378331005");
        assertThat(result.getYieldToMaturity()).isGreaterThan(0);
        assertThat(result.getDuration()).isGreaterThan(0);
        assertThat(result.getConvexity()).isGreaterThan(0);
        assertThat(result.getCleanPrice()).isEqualTo(98.5);
        assertThat(result.getDirtyPrice()).isGreaterThan(98.5);
        assertThat(result.getCurrentYield()).isGreaterThan(0);
    }

    @Test
    void calculateBondMetrics_invalidIsin_returnsNull() {
        BondCalculationRequest req = new BondCalculationRequest();
        req.setIsin("INVALID");
        req.setFaceValue(100.0);
        req.setCouponRate(3.5);
        req.setMarketPrice(98.5);
        req.setMaturityYears(5);

        BondCalculationResult result = service.calculateBondMetrics(req);

        assertThat(result).isNull();
    }

    @Test
    void calculateBondMetrics_maturityExceeds30Years_returnsNull() {
        BondCalculationRequest req = new BondCalculationRequest();
        req.setIsin("US0378331005");
        req.setFaceValue(100.0);
        req.setCouponRate(3.5);
        req.setMarketPrice(98.5);
        req.setMaturityYears(40); // too long

        BondCalculationResult result = service.calculateBondMetrics(req);

        assertThat(result).isNull();
    }

    @Test
    void getTrades_returnsAllTrades() {
        service.executeTrade(buildTrade("US0378331005", "CORPORATE", "BUY", 10, 98.0, 3.0, 0.0, 0.0, 0.0));
        service.executeTrade(buildTrade("US5949181045", "GOVERNMENT", "BUY", 20, 99.0, 2.5, 0.0, 0.0, 0.0));

        List<BondTrade> trades = service.getTrades();

        assertThat(trades).hasSize(2);
    }

    @Test
    void getTrade_returnsById() {
        BondTrade t = service.executeTrade(buildTrade("US30231G1022", "CORPORATE", "BUY", 5, 97.0, 4.0, 0.0, 0.0, 0.0));

        BondTrade found = service.getTrade(t.getTradeId());

        assertThat(found).isNotNull();
        assertThat(found.getIsin()).isEqualTo("US30231G1022");
    }

    @Test
    void getTrade_unknownId_returnsNull() {
        assertThat(service.getTrade("UNKNOWN")).isNull();
    }

    private BondTrade buildTrade(String isin, String bondType, String side, int qty, double price,
                                  double couponRate, double ytm, double duration, double convexity) {
        BondTrade t = new BondTrade();
        t.setIsin(isin);
        t.setSymbol("BOND-" + isin.substring(0, 4));
        t.setBondType(bondType);
        t.setSide(side);
        t.setQuantity(qty);
        t.setPrice(price);
        t.setCouponRate(couponRate);
        t.setMaturityDate("2031-06-15");
        t.setYieldToMaturity(ytm);
        t.setDuration(duration);
        t.setConvexity(convexity);
        return t;
    }
}
