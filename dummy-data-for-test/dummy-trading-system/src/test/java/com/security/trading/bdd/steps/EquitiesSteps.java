package com.security.trading.bdd.steps;

import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.security.trading.bdd.ScenarioContext;
import io.cucumber.datatable.DataTable;
import io.cucumber.java.en.And;
import io.cucumber.java.en.Given;
import io.cucumber.java.en.Then;
import io.cucumber.java.en.When;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

public class EquitiesSteps {

    private static final Logger logger = LogManager.getLogger(EquitiesSteps.class);

    @Autowired
    @Qualifier("bddRestTemplate")
    private RestTemplate restTemplate;

    @Autowired
    @Qualifier("bddAuthHeaders")
    private HttpHeaders authHeaders;

    @Autowired
    private ScenarioContext context;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private Map<String, Object> tradeRequest;

    @Given("the trading system is running")
    public void theTradingSystemIsRunning() {
        logger.info("[BDD] Verifying trading system is running at configured endpoint");
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/equities/trades", HttpMethod.GET, new HttpEntity<>(authHeaders), String.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        logger.info("[BDD] Trading system is UP — health check passed");
    }

    @Given("I have an equity trade request:")
    public void iHaveAnEquityTradeRequest(DataTable dataTable) {
        List<Map<String, String>> rows = dataTable.asMaps();
        Map<String, String> row = rows.get(0);
        tradeRequest = new HashMap<>();
        tradeRequest.put("symbol", row.get("symbol"));
        tradeRequest.put("quantity", Integer.parseInt(row.get("quantity")));
        tradeRequest.put("price", Double.parseDouble(row.get("price")));
        tradeRequest.put("side", row.get("side"));
        tradeRequest.put("exchange", row.get("exchange"));
        tradeRequest.put("orderType", row.get("orderType"));
        tradeRequest.put("timeInForce", row.get("timeInForce"));
        logger.info("[BDD] Equity trade request prepared: symbol={}, qty={}, price={}, side={}",
                row.get("symbol"), row.get("quantity"), row.get("price"), row.get("side"));
    }

    @When("I submit the equity trade")
    public void iSubmitTheEquityTrade() {
        logger.info("[BDD] Submitting equity trade: {}", tradeRequest);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(tradeRequest, authHeaders);
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/equities/trade", HttpMethod.POST, entity, String.class);
        context.setLastResponse(response);
        try {
            JsonNode node = objectMapper.readTree(response.getBody());
            if (node.has("tradeId")) {
                context.setLastId(node.get("tradeId").asText());
                logger.info("[BDD] Equity trade submitted: tradeId={}, status={}",
                        node.get("tradeId").asText(),
                        node.has("status") ? node.get("status").asText() : "N/A");
            }
        } catch (Exception e) {
            logger.warn("[BDD] Could not parse trade response: {}", e.getMessage());
        }
    }

    @Given("at least one equity trade has been executed")
    public void atLeastOneEquityTradeHasBeenExecuted() {
        Map<String, Object> trade = new HashMap<>();
        trade.put("symbol", "IBM");
        trade.put("quantity", 10);
        trade.put("price", 185.00);
        trade.put("side", "BUY");
        trade.put("exchange", "NYSE");
        trade.put("orderType", "MARKET");
        trade.put("timeInForce", "DAY");
        restTemplate.exchange("/api/equities/trade", HttpMethod.POST,
                new HttpEntity<>(trade, authHeaders), String.class);
        logger.info("[BDD] Precondition: executed a seed equity trade for IBM");
    }

    @When("I request all equity trades")
    public void iRequestAllEquityTrades() {
        logger.info("[BDD] Requesting all equity trades");
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/equities/trades", HttpMethod.GET, new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        logger.info("[BDD] GET /api/equities/trades returned HTTP {}", response.getStatusCode().value());
    }

    @Given("I have executed an equity trade for {string} with quantity {int} at price {double}")
    public void iHaveExecutedAnEquityTradeForWithQuantityAtPrice(String symbol, int qty, double price) {
        Map<String, Object> trade = new HashMap<>();
        trade.put("symbol", symbol);
        trade.put("quantity", qty);
        trade.put("price", price);
        trade.put("side", "BUY");
        trade.put("exchange", "NASDAQ");
        trade.put("orderType", "LIMIT");
        trade.put("timeInForce", "DAY");
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/equities/trade", HttpMethod.POST,
                new HttpEntity<>(trade, authHeaders), String.class);
        try {
            JsonNode node = objectMapper.readTree(response.getBody());
            if (node.has("tradeId")) {
                context.setLastId(node.get("tradeId").asText());
                logger.info("[BDD] Pre-executed trade: symbol={}, tradeId={}", symbol, node.get("tradeId").asText());
            }
        } catch (Exception e) {
            logger.warn("[BDD] Could not extract tradeId: {}", e.getMessage());
        }
    }

    @When("I request the trade by its ID")
    public void iRequestTheTradeByItsId() {
        String tradeId = context.getLastId();
        logger.info("[BDD] Requesting equity trade by ID: {}", tradeId);
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/equities/trades/" + tradeId, HttpMethod.GET,
                new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        logger.info("[BDD] GET /api/equities/trades/{} returned HTTP {}", tradeId, response.getStatusCode().value());
    }

    // ---- Assertion steps ----

    @Then("the response status code is {int}")
    public void theResponseStatusCodeIs(int expectedStatus) {
        assertThat(context.getLastResponse().getStatusCode().value()).isEqualTo(expectedStatus);
        logger.info("[BDD] Assertion passed: HTTP status = {}", expectedStatus);
    }

    @And("the trade status is {string}")
    public void theTradeStatusIs(String expectedStatus) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        String actualStatus = node.get("status").asText();
        assertThat(actualStatus).isEqualTo(expectedStatus);
        logger.info("[BDD] Assertion passed: trade status = {}", actualStatus);
    }

    @And("the trade has a valid trade ID")
    public void theTradeHasAValidTradeID() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("tradeId")).isTrue();
        assertThat(node.get("tradeId").asText()).isNotBlank();
        logger.info("[BDD] Assertion passed: trade has tradeId = {}", node.get("tradeId").asText());
    }

    @And("the trade symbol is {string}")
    public void theTradeSymbolIs(String expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("symbol").asText()).isEqualTo(expected);
        logger.info("[BDD] Assertion passed: trade symbol = {}", expected);
    }

    @And("the trade side is {string}")
    public void theTradeSideIs(String expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("side").asText()).isEqualTo(expected);
        logger.info("[BDD] Assertion passed: trade side = {}", expected);
    }

    @And("the response contains a list of trades")
    public void theResponseContainsAListOfTrades() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.isArray()).isTrue();
        logger.info("[BDD] Assertion passed: response is an array with {} trades", node.size());
    }

    @And("the returned trade symbol is {string}")
    public void theReturnedTradeSymbolIs(String expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("symbol").asText()).isEqualTo(expected);
        logger.info("[BDD] Assertion passed: returned trade symbol = {}", expected);
    }

    @And("the returned trade quantity is {int}")
    public void theReturnedTradeQuantityIs(int expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("quantity").asInt()).isEqualTo(expected);
        logger.info("[BDD] Assertion passed: returned trade quantity = {}", expected);
    }
}
