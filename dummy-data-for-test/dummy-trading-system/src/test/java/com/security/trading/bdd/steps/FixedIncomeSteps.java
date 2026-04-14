package com.security.trading.bdd.steps;

import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.security.trading.bdd.ScenarioContext;
import io.cucumber.datatable.DataTable;
import io.cucumber.java.en.And;
import io.cucumber.java.en.Given;
import io.cucumber.java.en.When;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

public class FixedIncomeSteps {

    private static final Logger logger = LogManager.getLogger(FixedIncomeSteps.class);

    @Autowired
    @Qualifier("bddRestTemplate")
    private RestTemplate restTemplate;

    @Autowired
    @Qualifier("bddAuthHeaders")
    private HttpHeaders authHeaders;

    @Autowired
    private ScenarioContext context;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @When("I submit a bond trade:")
    public void iSubmitABondTrade(DataTable dataTable) {
        List<Map<String, String>> rows = dataTable.asMaps();
        Map<String, String> row = rows.get(0);
        Map<String, Object> body = new HashMap<>();
        body.put("symbol", row.get("symbol"));
        body.put("isin", row.get("isin"));
        body.put("bondType", row.get("bondType"));
        body.put("side", row.get("side"));
        body.put("quantity", Integer.parseInt(row.get("quantity")));
        body.put("price", Double.parseDouble(row.get("price")));
        body.put("couponRate", Double.parseDouble(row.get("couponRate")));
        body.put("maturityDate", row.get("maturityDate"));
        body.put("yieldToMaturity", Double.parseDouble(row.get("yieldToMaturity")));
        logger.info("[BDD] Submitting bond trade: symbol={}, isin={}, side={}, qty={}, price={}",
                row.get("symbol"), row.get("isin"), row.get("side"),
                row.get("quantity"), row.get("price"));
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/fixedincome/trade", HttpMethod.POST,
                new HttpEntity<>(body, authHeaders), String.class);
        context.setLastResponse(response);
        try {
            JsonNode node = objectMapper.readTree(response.getBody());
            if (node.has("tradeId")) {
                context.setLastId(node.get("tradeId").asText());
                logger.info("[BDD] Bond trade submitted: tradeId={}, isin={}, status={}",
                        node.get("tradeId").asText(),
                        node.has("isin") ? node.get("isin").asText() : "N/A",
                        node.has("status") ? node.get("status").asText() : "N/A");
            }
        } catch (Exception e) {
            logger.warn("[BDD] Could not parse bond trade response: {}", e.getMessage());
        }
    }

    @When("I request bond metrics:")
    public void iRequestBondMetrics(DataTable dataTable) {
        List<Map<String, String>> rows = dataTable.asMaps();
        Map<String, String> row = rows.get(0);
        Map<String, Object> body = new HashMap<>();
        body.put("isin", row.get("isin"));
        body.put("faceValue", Double.parseDouble(row.get("faceValue")));
        body.put("couponRate", Double.parseDouble(row.get("couponRate")));
        body.put("maturityDate", row.get("maturityDate"));
        body.put("marketPrice", Double.parseDouble(row.get("marketPrice")));
        body.put("maturityYears", Integer.parseInt(row.get("maturityYears")));
        body.put("settlementDate", row.get("settlementDate"));
        logger.info("[BDD] Requesting bond metrics: isin={}, faceValue={}, couponRate={}, marketPrice={}",
                row.get("isin"), row.get("faceValue"), row.get("couponRate"), row.get("marketPrice"));
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/fixedincome/calculate", HttpMethod.POST,
                new HttpEntity<>(body, authHeaders), String.class);
        context.setLastResponse(response);
        try {
            JsonNode node = objectMapper.readTree(response.getBody());
            logger.info("[BDD] Bond metrics: isin={}, ytm={}, duration={}, convexity={}",
                    node.has("isin") ? node.get("isin").asText() : "N/A",
                    node.has("yieldToMaturity") ? String.format("%.4f", node.get("yieldToMaturity").asDouble()) : "N/A",
                    node.has("duration") ? String.format("%.4f", node.get("duration").asDouble()) : "N/A",
                    node.has("convexity") ? String.format("%.4f", node.get("convexity").asDouble()) : "N/A");
        } catch (Exception e) {
            logger.warn("[BDD] Could not parse bond metrics response: {}", e.getMessage());
        }
    }

    @Given("at least one bond trade has been executed")
    public void atLeastOneBondTradeHasBeenExecuted() {
        Map<String, Object> trade = new HashMap<>();
        trade.put("symbol", "USB-5Y");
        trade.put("isin", "US912828YV68");
        trade.put("bondType", "GOVERNMENT");
        trade.put("side", "BUY");
        trade.put("quantity", 10);
        trade.put("price", 99.00);
        trade.put("couponRate", 2.5);
        trade.put("maturityDate", "2031-03-15");
        trade.put("yieldToMaturity", 0.0);
        restTemplate.exchange("/api/fixedincome/trade", HttpMethod.POST,
                new HttpEntity<>(trade, authHeaders), String.class);
        logger.info("[BDD] Precondition: executed a seed bond trade for US912828YV68");
    }

    @When("I request all bond trades")
    public void iRequestAllBondTrades() {
        logger.info("[BDD] Requesting all bond trades");
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/fixedincome/trades", HttpMethod.GET, new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        logger.info("[BDD] GET /api/fixedincome/trades returned HTTP {}", response.getStatusCode().value());
    }

    @Given("I have executed a bond trade for {string} with quantity {int} at price {double}")
    public void iHaveExecutedABondTradeForWithQuantityAtPrice(String isin, int qty, double price) {
        Map<String, Object> trade = new HashMap<>();
        trade.put("symbol", "BOND-" + isin.substring(0, 4));
        trade.put("isin", isin);
        trade.put("bondType", "CORPORATE");
        trade.put("side", "BUY");
        trade.put("quantity", qty);
        trade.put("price", price);
        trade.put("couponRate", 3.0);
        trade.put("maturityDate", "2033-06-15");
        trade.put("yieldToMaturity", 0.0);
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/fixedincome/trade", HttpMethod.POST,
                new HttpEntity<>(trade, authHeaders), String.class);
        try {
            JsonNode node = objectMapper.readTree(response.getBody());
            if (node.has("tradeId")) {
                context.setLastId(node.get("tradeId").asText());
                logger.info("[BDD] Pre-executed bond trade: isin={}, tradeId={}", isin, node.get("tradeId").asText());
            }
        } catch (Exception e) {
            logger.warn("[BDD] Could not extract bond tradeId: {}", e.getMessage());
        }
    }

    @When("I request the bond trade by its ID")
    public void iRequestTheBondTradeByItsId() {
        String tradeId = context.getLastId();
        logger.info("[BDD] Requesting bond trade by ID: {}", tradeId);
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/fixedincome/trades/" + tradeId, HttpMethod.GET,
                new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        logger.info("[BDD] GET /api/fixedincome/trades/{} returned HTTP {}", tradeId, response.getStatusCode().value());
    }

    @And("the bond trade has a valid trade ID")
    public void theBondTradeHasAValidTradeID() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("tradeId")).isTrue();
        assertThat(node.get("tradeId").asText()).isNotBlank();
        logger.info("[BDD] Assertion passed: bond tradeId = {}", node.get("tradeId").asText());
    }

    @And("the bond trade status is {string}")
    public void theBondTradeStatusIs(String expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("status").asText()).isEqualTo(expected);
        logger.info("[BDD] Assertion passed: bond trade status = {}", expected);
    }

    @And("the bond trade has computed yield to maturity")
    public void theBondTradeHasComputedYieldToMaturity() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("yieldToMaturity")).isTrue();
        assertThat(node.get("yieldToMaturity").asDouble()).isGreaterThan(0);
        logger.info("[BDD] Assertion passed: YTM = {}", node.get("yieldToMaturity").asDouble());
    }

    @And("the bond metrics include yield to maturity")
    public void theBondMetricsIncludeYieldToMaturity() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("yieldToMaturity")).isTrue();
        logger.info("[BDD] Assertion passed: bond metrics YTM = {}", node.get("yieldToMaturity").asDouble());
    }

    @And("the bond metrics include duration")
    public void theBondMetricsIncludeDuration() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("duration")).isTrue();
        logger.info("[BDD] Assertion passed: bond metrics duration = {}", node.get("duration").asDouble());
    }

    @And("the bond metrics include convexity")
    public void theBondMetricsIncludeConvexity() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("convexity")).isTrue();
        logger.info("[BDD] Assertion passed: bond metrics convexity = {}", node.get("convexity").asDouble());
    }

    @And("the response contains a list of bond trades")
    public void theResponseContainsAListOfBondTrades() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.isArray()).isTrue();
        logger.info("[BDD] Assertion passed: response is an array with {} bond trades", node.size());
    }

    @And("the returned bond ISIN is {string}")
    public void theReturnedBondIsinIs(String expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("isin").asText()).isEqualTo(expected);
        logger.info("[BDD] Assertion passed: returned bond ISIN = {}", expected);
    }
}
