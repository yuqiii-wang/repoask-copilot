package com.security.trading.service;


import com.security.trading.service.impl.FxServiceImpl;
import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;
import com.security.trading.service.impl.*;

import com.security.trading.model.entity.FxRate;
import com.security.trading.service.FxService;
import com.security.trading.model.entity.FxTrade;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class FxServiceTest {

    private FxServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new FxServiceImpl();
    }

    @Test
    void executeTrade_knownPair_executesWithAutoRate() {
        FxTrade trade = buildTrade("EURUSD", "BUY", 100_000, 0.0, "SPOT");

        FxTrade result = service.executeTrade(trade);

        assertThat(result.getTradeId()).startsWith("FX-");
        assertThat(result.getStatus()).isEqualTo("EXECUTED");
        assertThat(result.getExchangeRate()).isGreaterThan(0);
        assertThat(result.getTimestamp()).isNotNull();
    }

    @Test
    void executeTrade_withProvidedRate_usesProvidedRate() {
        FxTrade trade = buildTrade("GBPUSD", "SELL", 50_000, 1.28, "SPOT");

        FxTrade result = service.executeTrade(trade);

        assertThat(result.getStatus()).isEqualTo("EXECUTED");
        assertThat(result.getExchangeRate()).isEqualTo(1.28);
    }

    @Test
    void executeTrade_unknownPair_rejects() {
        FxTrade trade = buildTrade("XYZABC", "BUY", 10_000, 0.0, "SPOT");

        FxTrade result = service.executeTrade(trade);

        assertThat(result.getStatus()).isEqualTo("REJECTED");
        assertThat(result.getFilledQuantity()).isEqualTo(0);
    }

    @Test
    void executeTrade_keepsExistingTradeId() {
        FxTrade trade = buildTrade("USDJPY", "BUY", 10_000, 151.5, "SPOT");
        trade.setTradeId("FX-CUSTOM-001");

        FxTrade result = service.executeTrade(trade);

        assertThat(result.getTradeId()).isEqualTo("FX-CUSTOM-001");
    }

    @Test
    void getExchangeRate_knownPair_returnsBidAndAsk() {
        FxRate rate = service.getExchangeRate("EURUSD");

        assertThat(rate).isNotNull();
        assertThat(rate.getBid()).isGreaterThan(0);
        assertThat(rate.getAsk()).isGreaterThan(rate.getBid());
        assertThat(rate.getMid()).isBetween(rate.getBid(), rate.getAsk());
        assertThat(rate.getCurrencyPair()).isEqualTo("EURUSD");
    }

    @Test
    void getExchangeRate_unknownPair_returnsGeneratedRate() {
        // FxService generates a fallback rate for unknown pairs (never returns null)
        FxRate rate = service.getExchangeRate("XYZABC");
        assertThat(rate).isNotNull();
        assertThat(rate.getCurrencyPair()).isEqualTo("XYZABC");
        assertThat(rate.getMid()).isGreaterThan(0);
    }

    @Test
    void getTrades_returnsAllTrades() {
        service.executeTrade(buildTrade("EURUSD", "BUY", 100_000, 1.09, "SPOT"));
        service.executeTrade(buildTrade("GBPUSD", "SELL", 50_000, 1.27, "SPOT"));

        List<FxTrade> trades = service.getTrades();

        assertThat(trades).hasSize(2);
    }

    @Test
    void getTrade_returnsById() {
        FxTrade t = service.executeTrade(buildTrade("USDJPY", "BUY", 10_000, 151.0, "FORWARD"));

        FxTrade found = service.getTrade(t.getTradeId());

        assertThat(found).isNotNull();
        assertThat(found.getCurrencyPair()).isEqualTo("USDJPY");
    }

    @Test
    void getTrade_unknownId_returnsNull() {
        assertThat(service.getTrade("UNKNOWN")).isNull();
    }

    private FxTrade buildTrade(String pair, String side, int qty, double rate, String type) {
        FxTrade t = new FxTrade();
        t.setCurrencyPair(pair);
        t.setSide(side);
        t.setQuantity(qty);
        t.setExchangeRate(rate);
        t.setTradeType(type);
        return t;
    }
}
