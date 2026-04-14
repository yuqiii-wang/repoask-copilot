package com.security.trading.service;


import com.security.trading.chaos.NoOpFaultInjectionService;
import com.security.trading.client.SettlementGatewayFeignClient;
import com.security.trading.service.impl.SettlementServiceImpl;
import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;
import com.security.trading.service.impl.*;

import com.security.trading.model.entity.Settlement;
import com.security.trading.service.SettlementService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SettlementServiceTest {

    private SettlementServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new SettlementServiceImpl(
                Mockito.mock(SettlementGatewayFeignClient.class),
                new NoOpFaultInjectionService());
    }

    @Test
    void createSettlement_generatesIdAndSetsPending() {
        Settlement s = buildSettlement("TRD-001", "US0378331005", 10000.0);

        Settlement result = service.createSettlement(s);

        assertThat(result.getSettlementId()).isNotBlank().startsWith("SETTLE-");
        assertThat(result.getStatus()).isEqualTo("PENDING");
        assertThat(result.getCreatedAt()).isNotNull();
        assertThat(result.getUpdatedAt()).isNotNull();
    }

    @Test
    void createSettlement_keepsExistingId() {
        Settlement s = buildSettlement("TRD-002", "US5949181045", 5000.0);
        s.setSettlementId("SETTLE-CUSTOM-001");

        Settlement result = service.createSettlement(s);

        assertThat(result.getSettlementId()).isEqualTo("SETTLE-CUSTOM-001");
    }

    @Test
    void processSettlement_invalidIsin_setsFailed() {
        Settlement s = buildSettlement("TRD-003", "INVALID_ISIN", 5000.0);
        Settlement created = service.createSettlement(s);

        Settlement processed = service.processSettlement(created.getSettlementId());

        assertThat(processed.getStatus()).isEqualTo("FAILED");
        assertThat(processed.getFailureReason()).contains("Invalid ISIN");
    }

    @Test
    void processSettlement_amountExceedsCashLimit_setsFailed() {
        Settlement s = buildSettlement("TRD-004", "US0378331005", 600000.0);
        Settlement created = service.createSettlement(s);

        Settlement processed = service.processSettlement(created.getSettlementId());

        assertThat(processed.getStatus()).isEqualTo("FAILED");
        assertThat(processed.getFailureReason()).contains("Insufficient");
    }

    @Test
    void processSettlement_validSettlement_processedOrFailed() {
        Settlement s = buildSettlement("TRD-005", "US0378331005", 100.0);
        Settlement created = service.createSettlement(s);

        Settlement processed = service.processSettlement(created.getSettlementId());

        assertThat(processed.getStatus()).isIn("PROCESSED", "FAILED");
        assertThat(processed.getUpdatedAt()).isNotNull();
    }

    @Test
    void processSettlement_unknownId_returnsNull() {
        assertThat(service.processSettlement("UNKNOWN")).isNull();
    }

    @Test
    void getSettlements_returnsAllSettlements() {
        service.createSettlement(buildSettlement("TRD-A", "US0378331005", 1000.0));
        service.createSettlement(buildSettlement("TRD-B", "US5949181045", 2000.0));

        List<Settlement> all = service.getSettlements();

        assertThat(all).hasSize(2);
    }

    @Test
    void getSettlement_returnsById() {
        Settlement s = service.createSettlement(buildSettlement("TRD-C", "US88160R1014", 3000.0));

        Settlement found = service.getSettlement(s.getSettlementId());

        assertThat(found).isNotNull();
        assertThat(found.getTradeId()).isEqualTo("TRD-C");
    }

    @Test
    void getSettlementsByTradeId_returnMatchingSettlements() {
        service.createSettlement(buildSettlement("TRD-X1", "US0378331005", 1000.0));
        service.createSettlement(buildSettlement("TRD-X1", "US4592001014", 2000.0));
        service.createSettlement(buildSettlement("TRD-X2", "US0378331005", 3000.0));

        List<Settlement> result = service.getSettlementsByTradeId("TRD-X1");

        assertThat(result).hasSize(2);
        assertThat(result).allMatch(s -> "TRD-X1".equals(s.getTradeId()));
    }

    private Settlement buildSettlement(String tradeId, String isin, double amount) {
        Settlement s = new Settlement();
        s.setTradeId(tradeId);
        s.setIsin(isin);
        s.setSettlementAmount(amount);
        s.setCurrency("USD");
        s.setCounterparty("BROKER-A");
        s.setSettlementMethod("DTC");
        s.setSettlementDate("2026-04-15");
        return s;
    }
}
