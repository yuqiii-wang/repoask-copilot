package com.security.trading.service;


import com.security.trading.service.impl.AlgoServiceImpl;
import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;
import com.security.trading.service.impl.*;

import com.security.trading.service.AlgoService;
import com.security.trading.model.entity.AlgoStrategy;
import com.security.trading.model.dto.BacktestRequest;
import com.security.trading.model.dto.BacktestResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class AlgoServiceTest {

    private AlgoServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new AlgoServiceImpl();
    }

    @Test
    void createStrategy_generatesIdAndSetsInactive() {
        AlgoStrategy s = buildStrategy("VWAP", "VWAP");

        AlgoStrategy result = service.createStrategy(s);

        assertThat(result.getStrategyId()).startsWith("ALGO-");
        assertThat(result.getStatus()).isEqualTo("INACTIVE");
    }

    @Test
    void createStrategy_keepsExistingId() {
        AlgoStrategy s = buildStrategy("MY-STRAT", "TWAP");
        s.setStrategyId("ALGO-CUSTOM-001");

        AlgoStrategy result = service.createStrategy(s);

        assertThat(result.getStrategyId()).isEqualTo("ALGO-CUSTOM-001");
    }

    @Test
    void activateStrategy_sufficientBars_activates() {
        AlgoStrategy s = buildStrategy("Momentum", "ARBITRAGE");
        s.setMinBarsAvailable(252); // exactly at minimum → activates
        AlgoStrategy created = service.createStrategy(s);

        AlgoStrategy activated = service.activateStrategy(created.getStrategyId());

        assertThat(activated.getStatus()).isEqualTo("ACTIVE");
    }

    @Test
    void activateStrategy_sufficientBarsWithTradingWindow_activates() {
        AlgoStrategy s = buildStrategy("VWAP-A", "VWAP");
        s.setMinBarsAvailable(300);
        s.setTradingWindow("09:30:00-16:00:00");
        AlgoStrategy created = service.createStrategy(s);

        AlgoStrategy activated = service.activateStrategy(created.getStrategyId());

        assertThat(activated.getStatus()).isEqualTo("ACTIVE");
    }

    @Test
    void activateStrategy_insufficientBars_staysInactive() {
        AlgoStrategy s = buildStrategy("Trend", "VWAP");
        s.setMinBarsAvailable(100); // below 252 → backstest fails
        AlgoStrategy created = service.createStrategy(s);

        AlgoStrategy result = service.activateStrategy(created.getStrategyId());

        assertThat(result.getStatus()).isEqualTo("INACTIVE");
    }

    @Test
    void activateStrategy_zeroBars_activates() {
        AlgoStrategy s = buildStrategy("New", "TWAP");
        s.setMinBarsAvailable(0); // zero bars → not in (0, 252) range → activates
        AlgoStrategy created = service.createStrategy(s);

        AlgoStrategy result = service.activateStrategy(created.getStrategyId());

        assertThat(result.getStatus()).isEqualTo("ACTIVE");
    }

    @Test
    void activateStrategy_unknownId_returnsNull() {
        assertThat(service.activateStrategy("UNKNOWN")).isNull();
    }

    @Test
    void deactivateStrategy_activeStrategy_deactivates() {
        AlgoStrategy s = buildStrategy("DeactivateMe", "VWAP");
        s.setMinBarsAvailable(300);
        AlgoStrategy created = service.createStrategy(s);
        service.activateStrategy(created.getStrategyId());

        AlgoStrategy result = service.deactivateStrategy(created.getStrategyId());

        assertThat(result.getStatus()).isEqualTo("INACTIVE");
    }

    @Test
    void deactivateStrategy_unknownId_returnsNull() {
        assertThat(service.deactivateStrategy("UNKNOWN")).isNull();
    }

    @Test
    void getStrategies_returnsAllStrategies() {
        service.createStrategy(buildStrategy("S1", "VWAP"));
        service.createStrategy(buildStrategy("S2", "TWAP"));

        List<AlgoStrategy> strategies = service.getStrategies();

        assertThat(strategies).hasSize(2);
    }

    @Test
    void getStrategy_returnsById() {
        AlgoStrategy created = service.createStrategy(buildStrategy("Lookup", "ARBITRAGE"));

        AlgoStrategy found = service.getStrategy(created.getStrategyId());

        assertThat(found).isNotNull();
        assertThat(found.getName()).isEqualTo("Lookup");
    }

    @Test
    void getStrategy_unknownId_returnsNull() {
        assertThat(service.getStrategy("UNKNOWN")).isNull();
    }

    @Test
    void backtestStrategy_returnsResultWithMetrics() {
        AlgoStrategy s = buildStrategy("Backtest-S", "VWAP");
        s.setMinBarsAvailable(300);
        AlgoStrategy created = service.createStrategy(s);

        BacktestRequest req = new BacktestRequest();
        req.setStrategyId(created.getStrategyId());
        req.setSymbol("AAPL");
        req.setStartDate("2025-01-01");
        req.setEndDate("2025-12-31");
        req.setInitialCapital(100_000.0);

        BacktestResult result = service.backtestStrategy(req);

        assertThat(result).isNotNull();
        assertThat(result.getBacktestId()).isNotBlank();
        assertThat(result.getStrategyId()).isEqualTo(created.getStrategyId());
        assertThat(result.getFinalCapital()).isGreaterThan(0);
    }

    private AlgoStrategy buildStrategy(String name, String type) {
        AlgoStrategy s = new AlgoStrategy();
        s.setName(name);
        s.setType(type);
        s.setDescription("Test strategy: " + name);
        return s;
    }
}
