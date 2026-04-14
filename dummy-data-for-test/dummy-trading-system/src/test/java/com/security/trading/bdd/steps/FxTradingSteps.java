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
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

public class FxTradingSteps {

    private static final Logger logger = LogManager.getLogger(FxTradingSteps.class);

    @Autowired
    @Qualifier("bddRestTemplate")
    private RestTemplate restTemplate;

    @Autowired
    @Qualifier("bddAuthHeaders")
    private HttpHeaders authHeaders;

    @Autowired
    private ScenarioContext context;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private Map<String, Object> fxTradeRequest;

    @Given("I have an FX trade request:")
    public void iHaveAnFxTradeRequest(DataTable dataTable) {
        List<Map<String, String>> rows = dataTable.asMaps();
        Map<String, String> row = rows.get(0);
        fxTradeRequest = new HashMap<>();
        fxTradeRequest.put("currencyPair", row.get("currencyPair"));
        fxTradeRequest.put("quantity", Double.parseDouble(row.get("quantity")));
        fxTradeRequest.put("side", row.get("side"));
        fxTradeRequest.put("tradeType", row.get("tradeType"));
        fxTradeRequest.put("exchangeRate", Double.parseDouble(row.get("exchangeRate")));
        logger.info("[BDD] FX trade request prepared: pair={}, qty={}, side={}",
                row.get("currencyPair"), row.get("quantity"), row.get("side"));
    }

    @When("I submit the FX trade")
    public void iSubmitTheFxTrade() {
        logger.info("[BDD] Submitting FX trade: {}", fxTradeRequest);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(fxTradeRequest, authHeaders);
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/fx/trade", HttpMethod.POST, entity, String.class);
        context.setLastResponse(response);
        try {
            JsonNode node = objectMapper.readTree(response.getBody());
            if (node.has("tradeId")) {
                context.setLastId(node.get("tradeId").asText());
                logger.info("[BDD] FX trade submitted: tradeId={}, pair={}, status={}",
                        node.get("tradeId").asText(),
                        node.has("currencyPair") ? node.get("currencyPair").asText() : "N/A",
                        node.has("status") ? node.get("status").asText() : "N/A");
            }
        } catch (Exception e) {
            logger.warn("[BDD] Could not parse FX trade response: {}", e.getMessage());
        }
    }

    @And("the FX trade status is {string}")
    public void theFxTradeStatusIs(String expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("status").asText()).isEqualTo(expected);
        logger.info("[BDD] Assertion passed: FX trade status = {}", expected);
    }

    @And("the FX trade has a valid trade ID")
    public void theFxTradeHasAValidTradeID() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("tradeId")).isTrue();
        assertThat(node.get("tradeId").asText()).isNotBlank();
        logger.info("[BDD] Assertion passed: FX tradeId = {}", node.get("tradeId").asText());
    }

    @And("the currency pair is {string}")
    public void theCurrencyPairIs(String expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("currencyPair").asText()).isEqualTo(expected);
        logger.info("[BDD] Assertion passed: currency pair = {}", expected);
    }

    @When("I request the exchange rate for {string}")
    public void iRequestTheExchangeRateFor(String pair) {
        logger.info("[BDD] Requesting FX rate for pair: {}", pair);
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/fx/rates/" + pair, HttpMethod.GET, new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        logger.info("[BDD] GET /api/fx/rates/{} returned HTTP {}", pair, response.getStatusCode().value());
    }

    @And("the rate has a bid price")
    public void theRateHasABidPrice() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("bid")).isTrue();
        assertThat(node.get("bid").asDouble()).isGreaterThan(0);
        logger.info("[BDD] Assertion passed: bid = {}", node.get("bid").asDouble());
    }

    @And("the rate has an ask price")
    public void theRateHasAnAskPrice() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("ask")).isTrue();
        assertThat(node.get("ask").asDouble()).isGreaterThan(0);
        logger.info("[BDD] Assertion passed: ask = {}", node.get("ask").asDouble());
    }

    @And("the ask price is greater than the bid price")
    public void theAskPriceIsGreaterThanTheBidPrice() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        double bid = node.get("bid").asDouble();
        double ask = node.get("ask").asDouble();
        assertThat(ask).isGreaterThan(bid);
        logger.info("[BDD] Assertion passed: ask({}) > bid({})", ask, bid);
    }

    @And("the currency pair returned is {string}")
    public void theCurrencyPairReturnedIs(String expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("currencyPair").asText()).isEqualTo(expected);
        logger.info("[BDD] Assertion passed: returned pair = {}", expected);
    }

    @Given("at least one FX trade has been executed")
    public void atLeastOneFxTradeHasBeenExecuted() {
        Map<String, Object> trade = new HashMap<>();
        trade.put("currencyPair", "USDCNY");
        trade.put("quantity", 10000.0);
        trade.put("side", "BUY");
        trade.put("tradeType", "SPOT");
        trade.put("exchangeRate", 7.15);
        restTemplate.exchange("/api/fx/trade", HttpMethod.POST,
                new HttpEntity<>(trade, authHeaders), String.class);
        logger.info("[BDD] Precondition: executed a seed FX trade for USDCNY");
    }

    @When("I request all FX trades")
    public void iRequestAllFxTrades() {
        logger.info("[BDD] Requesting all FX trades");
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/fx/trades", HttpMethod.GET, new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        logger.info("[BDD] GET /api/fx/trades returned HTTP {}", response.getStatusCode().value());
    }

    @And("the FX trades list is not empty")
    public void theFxTradesListIsNotEmpty() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.isArray()).isTrue();
        assertThat(node.size()).isGreaterThan(0);
        logger.info("[BDD] Assertion passed: FX trades list size = {}", node.size());
    }
}
