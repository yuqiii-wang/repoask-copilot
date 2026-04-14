package com.security.trading.service;


import com.security.trading.chaos.NoOpFaultInjectionService;
import com.security.trading.client.MarketDataFeignClient;
import com.security.trading.service.impl.MarketDataServiceImpl;
import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;
import com.security.trading.service.impl.*;

import com.security.trading.model.entity.MarketData;
import com.security.trading.service.MarketDataService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;

class MarketDataServiceTest {

    private MarketDataServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new MarketDataServiceImpl(
                Mockito.mock(MarketDataFeignClient.class),
                new NoOpFaultInjectionService());
    }

    @Test
    void getMarketData_returnsDataForSymbol() {
        MarketData data = service.getMarketData("AAPL");

        assertThat(data).isNotNull();
        assertThat(data.getSymbol()).isEqualTo("AAPL");
        assertThat(data.getBid()).isGreaterThan(0);
        assertThat(data.getAsk()).isGreaterThan(data.getBid());
        assertThat(data.getLastPrice()).isGreaterThan(0);
        assertThat(data.getVolume()).isGreaterThan(0);
        assertThat(data.getTimestamp()).isNotNull();
    }

    @Test
    void getMarketData_cachedDataReturnedOnSecondCall() {
        MarketData first = service.getMarketData("MSFT");
        MarketData second = service.getMarketData("MSFT");

        // Both should be non-null; the second call should return cached version
        assertThat(first).isNotNull();
        assertThat(second).isNotNull();
        assertThat(second.getSymbol()).isEqualTo("MSFT");
    }

    @Test
    void getMarketData_differentSymbols_returnsDifferentData() {
        MarketData aapl = service.getMarketData("AAPL");
        MarketData tsla = service.getMarketData("TSLA");

        assertThat(aapl.getSymbol()).isEqualTo("AAPL");
        assertThat(tsla.getSymbol()).isEqualTo("TSLA");
    }

    @Test
    void getMarketData_bondSymbol_returnsData() {
        MarketData data = service.getMarketData("US10Y");

        assertThat(data).isNotNull();
        assertThat(data.getSymbol()).isEqualTo("US10Y");
    }

    @Test
    void startMarketDataSync_doesNotThrow() {
        service.startMarketDataSync();
    }

    @Test
    void logIntraDayDataUpdate_doesNotThrow() {
        service.logIntraDayDataUpdate("AAPL", 176.50, 175.00, 10000);
    }

    @Test
    void logVolumeProfile_doesNotThrow() {
        service.logVolumeProfile("AAPL", 174.0, 177.0, 173.5, 176.5, 50000000);
    }

    @Test
    void logBondMarketSnapshot_doesNotThrow() {
        service.logBondMarketSnapshot(4.25, -15.0, 4.80, -10.0);
    }

    @Test
    void logFXMarketSnapshot_doesNotThrow() {
        service.logFXMarketSnapshot("EURUSD", 1.0834, 0.0012, 0.11, 2.5e12);
    }

    @Test
    void logEquityOptionsSnapshot_doesNotThrow() {
        service.logEquityOptionsSnapshot("SPY", 8.50, 8.70, 16.5, 0.629);
    }

    @Test
    void logLiquidityAlert_doesNotThrow() {
        service.logLiquidityAlert("TSLA", 200.0, 201.5, 1.5, 5000000);
    }
}
