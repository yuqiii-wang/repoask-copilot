package com.security.trading.service;


import com.security.trading.service.impl.RiskServiceImpl;
import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;
import com.security.trading.service.impl.*;

import com.security.trading.model.entity.RiskAssessment;
import com.security.trading.model.dto.RiskAssessmentRequest;
import com.security.trading.model.dto.RiskCheckRequest;
import com.security.trading.model.dto.RiskCheckResult;
import com.security.trading.service.RiskService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class RiskServiceTest {

    private RiskServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new RiskServiceImpl();
    }

    @Test
    void assessRisk_smallPortfolio_noLimitBreach() {
        RiskAssessmentRequest req = new RiskAssessmentRequest();
        req.setPortfolioId("PORT-001");
        req.setPortfolioValue(100_000.0);
        req.setRiskModel("VAR");
        req.setConfidenceLevel(99.0);
        req.setTimeHorizon(1);

        RiskAssessment result = service.assessRisk(req);

        assertThat(result.getAssessmentId()).startsWith("RISK-");
        assertThat(result.getPortfolioId()).isEqualTo("PORT-001");
        assertThat(result.getVar99()).isGreaterThan(0);
        assertThat(result.getVar95()).isGreaterThan(0);
        assertThat(result.getStressTestResult()).isGreaterThan(0);
        assertThat(result.getCounterpartyRisk()).isGreaterThan(0);
        assertThat(result.isLimitBreached()).isFalse();
        assertThat(result.getAssessmentTime()).isNotNull();
    }

    @Test
    void assessRisk_largePortfolioLongHorizon_limitBreached() {
        // large T will cause VaR99 to exceed 6%
        RiskAssessmentRequest req = new RiskAssessmentRequest();
        req.setPortfolioId("PORT-002");
        req.setPortfolioValue(10_000_000.0);
        req.setRiskModel("VAR");
        req.setConfidenceLevel(99.0);
        req.setTimeHorizon(252); // full year → high VaR%

        RiskAssessment result = service.assessRisk(req);

        assertThat(result.isLimitBreached()).isTrue();
        assertThat(result.getBreachReason()).isNotBlank();
    }

    @Test
    void getAssessments_returnsStoredAssessments() {
        RiskAssessmentRequest req = buildAssessmentRequest("PORT-003", 50_000.0);
        service.assessRisk(req);
        service.assessRisk(buildAssessmentRequest("PORT-004", 75_000.0));

        List<RiskAssessment> all = service.getAssessments();

        assertThat(all).hasSize(2);
    }

    @Test
    void getAssessment_returnsById() {
        RiskAssessment a = service.assessRisk(buildAssessmentRequest("PORT-005", 50_000.0));

        RiskAssessment found = service.getAssessment(a.getAssessmentId());

        assertThat(found).isNotNull();
        assertThat(found.getPortfolioId()).isEqualTo("PORT-005");
    }

    @Test
    void checkRisk_smallTrade_approved() {
        RiskCheckRequest req = buildCheckRequest("TRD-001", 1000.0, 100, 100.0, 5000.0);

        RiskCheckResult result = service.checkRisk(req);

        assertThat(result.isApproved()).isTrue();
        assertThat(result.getRiskStatus()).isEqualTo("APPROVED");
        assertThat(result.getTradeId()).isEqualTo("TRD-001");
    }

    @Test
    void checkRisk_highRiskScore_rejected() {
        // tradeValue 5,000,000 → riskScore >> 50 threshold
        RiskCheckRequest req = buildCheckRequest("TRD-002", 5_000_000.0, 10000, 500.0, 5000.0);

        RiskCheckResult result = service.checkRisk(req);

        assertThat(result.isApproved()).isFalse();
        assertThat(result.getRiskStatus()).isEqualTo("REJECTED");
        assertThat(result.getRejectionReason()).isNotBlank();
    }

    @Test
    void checkRisk_positionLimitExceeded_rejected() {
        RiskCheckRequest req = buildCheckRequest("TRD-003", 1000.0, 10, 100.0, 2_000_000.0);

        RiskCheckResult result = service.checkRisk(req);

        assertThat(result.isApproved()).isFalse();
        assertThat(result.getRiskStatus()).isEqualTo("REJECTED");
        assertThat(result.getRejectionReason()).contains("Position size");
    }

    @Test
    void startDailyMonitoring_doesNotThrow() {
        service.startDailyMonitoring(LocalDateTime.now(), LocalDateTime.now().plusHours(8));
    }

    @Test
    void logPortfolioSnapshot_doesNotThrow() {
        service.logPortfolioSnapshot("PORT-001", 1_000_000.0, 50);
    }

    @Test
    void checkSectorConcentration_withExceedingAndCompliantSectors() {
        Map<String, Double> weights = new HashMap<>();
        weights.put("TECHNOLOGY", 500_000.0); // 50% − exceeds 40% limit
        weights.put("FINANCIALS", 300_000.0); // 30% − OK
        double total = 1_000_000.0;

        // Should not throw; just logs warnings/info
        service.checkSectorConcentration(weights, total);
    }

    @Test
    void runStressTest_withinLimit_logsWithinLimit() {
        service.runStressTest("COVID-19", 1_000_000.0, 0.03); // 3% shock
    }

    @Test
    void runStressTest_limitBreached_logsBreached() {
        service.runStressTest("GFC-2008", 1_000_000.0, 0.10); // 10% shock
    }

    private RiskAssessmentRequest buildAssessmentRequest(String portfolioId, double value) {
        RiskAssessmentRequest r = new RiskAssessmentRequest();
        r.setPortfolioId(portfolioId);
        r.setPortfolioValue(value);
        r.setRiskModel("VAR");
        r.setConfidenceLevel(99.0);
        r.setTimeHorizon(10);
        return r;
    }

    private RiskCheckRequest buildCheckRequest(String tradeId, double tradeValue, int qty, double price, double position) {
        RiskCheckRequest r = new RiskCheckRequest();
        r.setTradeId(tradeId);
        r.setTradeType("EQUITY");
        r.setTradeValue(tradeValue);
        r.setCounterparty("BROKER-A");
        r.setPositionSize(position);
        r.setPrice(price);
        r.setQuantity(qty);
        return r;
    }
}
