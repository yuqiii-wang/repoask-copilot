package com.security.trading.chaos;

import com.security.trading.client.MarketDataFeignClient;
import com.security.trading.client.SettlementGatewayFeignClient;
import com.security.trading.client.dto.ExternalSettlementConfirmResponse;
import com.security.trading.model.entity.MarketData;
import com.security.trading.model.entity.Settlement;
import com.security.trading.service.MarketDataService;
import com.security.trading.service.SettlementService;
import com.security.trading.service.impl.MarketDataServiceImpl;
import com.security.trading.service.impl.SettlementServiceImpl;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.aop.AopAutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.retry.annotation.EnableRetry;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.junit.jupiter.SpringExtension;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;

/**
 * Chaos-profile integration tests.
 *
 * <p>Uses a focused Spring context containing only the services under test plus
 * Spring Retry AOP so that {@code @Retryable} proxies are active.
 * {@link ChaosEngineFaultInjectionService} is injected directly — it is profile-agnostic
 * when constructed explicitly, so no Spring profile activation is required here.
 *
 * <p>On the <em>first</em> attempt of each guarded service call a
 * {@code TradingException} sub-type is thrown.  Spring Retry automatically retries
 * and the <em>second</em> attempt passes.
 *
 * <p>Look in {@code logs/chaos-faults.log} (or console output) for lines like:
 * <pre>
 *   [CHAOS] Injecting TIMEOUT fault (call #1) for operation 'settlement.create'
 *   [CHAOS] Retry #2 PASSED for operation 'settlement.create' — fault window cleared
 * </pre>
 */
@ExtendWith(SpringExtension.class)
@ContextConfiguration(classes = {
        ChaosFaultIntegrationTest.ChaosTestConfig.class,
        AopAutoConfiguration.class
})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ChaosFaultIntegrationTest {

    // ── Minimal Spring context for chaos tests ──────────────────────────────────

    @Configuration
    @EnableRetry
    static class ChaosTestConfig {

        @Bean
        public FaultInjectionService faultInjectionService() {
            return new ChaosEngineFaultInjectionService();
        }

        @Bean
        public SettlementGatewayFeignClient settlementGatewayFeignClient() {
            ExternalSettlementConfirmResponse mockConfirm = new ExternalSettlementConfirmResponse();
            mockConfirm.setExternalRef("EXT-CHAOS-001");
            mockConfirm.setStatus("CONFIRMED");
            mockConfirm.setClearingHouse("DTC");
            mockConfirm.setSettledAmount(10000.0);
            mockConfirm.setConfirmedAt(LocalDateTime.now());
            SettlementGatewayFeignClient mock = Mockito.mock(SettlementGatewayFeignClient.class);
            Mockito.when(mock.confirmSettlement(any())).thenReturn(mockConfirm);
            return mock;
        }

        @Bean
        public MarketDataFeignClient marketDataFeignClient() {
            return Mockito.mock(MarketDataFeignClient.class);
        }

        @Bean
        public SettlementService settlementService(SettlementGatewayFeignClient client,
                                                   FaultInjectionService faultInjectionService) {
            return new SettlementServiceImpl(client, faultInjectionService);
        }

        @Bean
        public MarketDataService marketDataService(MarketDataFeignClient client,
                                                   FaultInjectionService faultInjectionService) {
            return new MarketDataServiceImpl(client, faultInjectionService);
        }
    }

    @Autowired
    SettlementService settlementService;

    @Autowired
    MarketDataService marketDataService;

    // ── Market data ─────────────────────────────────────────────────────────────

    /**
     * First call to getMarketData → fault injected (call#1, odd).
     * Spring Retry invokes it again → call#2 (even) → fault cleared → returns mock data.
     */
    @Test
    @Order(1)
    void getMarketData_chaosProfile_faultInjectedThenRetrySucceeds() {
        MarketData data = marketDataService.getMarketData("AAPL");

        assertThat(data).isNotNull();
        assertThat(data.getSymbol()).isEqualTo("AAPL");
        assertThat(data.getLastPrice()).isGreaterThan(0);
    }

    /**
     * Batch call uses the separate key "market-data.batch".
     * Call#1 → fault; retry call#2 → pass.
     */
    @Test
    @Order(2)
    void getMarketDataBatch_chaosProfile_faultInjectedThenRetrySucceeds() {
        MarketData[] results = marketDataService.getMarketDataBatch(new String[]{"MSFT", "TSLA"});

        assertThat(results).isNotNull().hasSize(2);
        assertThat(results[0].getSymbol()).isEqualTo("MSFT");
        assertThat(results[1].getSymbol()).isEqualTo("TSLA");
    }

    // ── Settlement ───────────────────────────────────────────────────────────────

    /**
     * First call to createSettlement → fault injected (call#1, odd) for "settlement.create".
     * Retry (call#2, even) → fault cleared → settlement stored.
     */
    @Test
    @Order(3)
    void createSettlement_chaosProfile_faultInjectedThenRetrySucceeds() {
        Settlement s = buildSettlement("CHAOS-TRD-001", "US0378331005", 10000.0);

        Settlement result = settlementService.createSettlement(s);

        assertThat(result).isNotNull();
        assertThat(result.getSettlementId()).isNotBlank().startsWith("SETTLE-");
        assertThat(result.getStatus()).isEqualTo("PENDING");
    }

    /**
     * Subsequent call to createSettlement: counter for "settlement.create" is 3 (odd)
     * → fault again → retry (4th call, even) → pass.
     * Demonstrates the fault re-arms on every odd call.
     */
    @Test
    @Order(4)
    void createSettlement_chaosProfile_faultReArmsOnEveryOddCall() {
        Settlement s = buildSettlement("CHAOS-TRD-002", "US5949181045", 5000.0);

        Settlement result = settlementService.createSettlement(s);

        assertThat(result).isNotNull();
        assertThat(result.getSettlementId()).isNotBlank();
        assertThat(result.getStatus()).isEqualTo("PENDING");
    }

    /**
     * processSettlement uses the separate key "settlement.process".
     * Call#1 → fault; retry call#2 → pass.
     * The mocked clearing gateway returns CONFIRMED so the settlement resolves to PROCESSED or FAILED.
     */
    @Test
    @Order(5)
    void processSettlement_chaosProfile_faultInjectedThenRetrySucceeds() {
        Settlement s = buildSettlement("CHAOS-TRD-010", "US0231351067", 1000.0);
        Settlement created = settlementService.createSettlement(s);

        Settlement processed = settlementService.processSettlement(created.getSettlementId());

        assertThat(processed).isNotNull();
        assertThat(processed.getStatus()).isIn("PROCESSED", "FAILED");
        assertThat(processed.getUpdatedAt()).isNotNull();
    }

    // ── Helper ───────────────────────────────────────────────────────────────────

    private Settlement buildSettlement(String tradeId, String isin, double amount) {
        Settlement s = new Settlement();
        s.setTradeId(tradeId);
        s.setIsin(isin);
        s.setSettlementAmount(amount);
        s.setCurrency("USD");
        s.setCounterparty("BROKER-CHAOS");
        s.setSettlementMethod("DTC");
        s.setSettlementDate("2026-04-15");
        return s;
    }
}

