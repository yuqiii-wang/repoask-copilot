package com.security.trading.bdd.steps;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.security.trading.bdd.ScenarioContext;
import io.cucumber.java.en.And;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Step definitions specific to the investment banking manager full-flow scenario.
 * Complements existing step definition classes with portfolio-level risk assertions
 * that verify the risk engine output before trade forwarding to settlement.
 */
public class InvestmentBankingFlowSteps {

    private static final Logger logger = LogManager.getLogger(InvestmentBankingFlowSteps.class);

    @Autowired
    private ScenarioContext context;

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Asserts that the last risk assessment response has {@code limitBreached == false}.
     * For the 1-day MONTE_CARLO assessment at $10m, VaR99 ≈ 2.2% of portfolio which
     * is below the 6% breach threshold computed by RiskServiceImpl.
     */
    @And("no portfolio risk limits are breached")
    public void noPortfolioRiskLimitsAreBreached() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("limitBreached")).isTrue();
        boolean limitBreached = node.get("limitBreached").asBoolean();
        assertThat(limitBreached)
                .as("Expected no risk limit breach for the combined equity + bond portfolio, "
                        + "but limitBreached=%s (breachReason='%s')",
                        limitBreached,
                        node.has("breachReason") ? node.get("breachReason").asText() : "none")
                .isFalse();
        logger.info("[BDD] Assertion passed: no portfolio risk limits breached");
    }

    /**
     * Asserts that the stress-test loss figure returned by the risk engine is
     * a positive number, confirming the stress scenario was actually executed.
     */
    @And("the portfolio stress test result is provided")
    public void thePortfolioStressTestResultIsProvided() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("stressTestResult")).isTrue();
        double stress = node.get("stressTestResult").asDouble();
        assertThat(stress)
                .as("Expected stressTestResult > 0 but got %s", stress)
                .isGreaterThan(0);
        logger.info("[BDD] Assertion passed: stressTestResult = {} (loss under 15% shock)",
                String.format("%.2f", stress));
    }
}
