package com.security.trading.service;


import com.security.trading.service.impl.EquityTradingServiceImpl;
import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;
import com.security.trading.service.impl.*;

import com.security.trading.model.entity.EquityTrade;
import com.security.trading.service.EquityTradingService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class EquityTradingServiceTest {

    private EquityTradingServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new EquityTradingServiceImpl();
    }

    @Test
    void executeTrade_generatesTradeIdAndSetsExecutedStatus() {
        EquityTrade trade = buildTrade("AAPL", "BUY", 100, 175.0);

        EquityTrade result = service.executeTrade(trade);

        assertThat(result.getTradeId()).isNotBlank().startsWith("EQ-");
        assertThat(result.getStatus()).isEqualTo("EXECUTED");
        assertThat(result.getFilledQuantity()).isEqualTo(100);
        assertThat(result.getAveragePrice()).isEqualTo(175.0);
        assertThat(result.getTimestamp()).isNotNull();
    }

    @Test
    void executeTrade_keepsExistingTradeId() {
        EquityTrade trade = buildTrade("TSLA", "SELL", 50, 200.0);
        trade.setTradeId("EQ-CUSTOM-001");

        EquityTrade result = service.executeTrade(trade);

        assertThat(result.getTradeId()).isEqualTo("EQ-CUSTOM-001");
    }

    @Test
    void getTrades_returnsAllExecutedTrades() {
        service.executeTrade(buildTrade("AAPL", "BUY", 100, 175.0));
        service.executeTrade(buildTrade("MSFT", "BUY", 200, 380.0));

        List<EquityTrade> trades = service.getTrades();

        assertThat(trades).hasSize(2);
    }

    @Test
    void getTrade_returnsTradeById() {
        EquityTrade t = service.executeTrade(buildTrade("AMZN", "BUY", 10, 185.0));

        EquityTrade found = service.getTrade(t.getTradeId());

        assertThat(found).isNotNull();
        assertThat(found.getSymbol()).isEqualTo("AMZN");
    }

    @Test
    void getTrade_returnsNullForUnknownId() {
        assertThat(service.getTrade("UNKNOWN")).isNull();
    }

    private EquityTrade buildTrade(String symbol, String side, int qty, double price) {
        EquityTrade t = new EquityTrade();
        t.setSymbol(symbol);
        t.setSide(side);
        t.setQuantity(qty);
        t.setPrice(price);
        return t;
    }
}
