package com.security.trading.bdd.steps;

import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.security.trading.bdd.ScenarioContext;
import io.cucumber.java.en.And;
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

import static org.assertj.core.api.Assertions.assertThat;

public class MarketDataSteps {

    private static final Logger logger = LogManager.getLogger(MarketDataSteps.class);

    @Autowired
    @Qualifier("bddRestTemplate")
    private RestTemplate restTemplate;

    @Autowired
    @Qualifier("bddAuthHeaders")
    private HttpHeaders authHeaders;

    @Autowired
    private ScenarioContext context;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @When("I request market data for symbol {string}")
    public void iRequestMarketDataForSymbol(String symbol) {
        logger.info("[BDD] Requesting market data for symbol: {}", symbol);
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/marketdata/quote/" + symbol, HttpMethod.GET, new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        try {
            JsonNode node = objectMapper.readTree(response.getBody());
            logger.info("[BDD] Market data for {}: bid={}, ask={}, last={}",
                    symbol,
                    node.has("bid") ? String.format("%.2f", node.get("bid").asDouble()) : "N/A",
                    node.has("ask") ? String.format("%.2f", node.get("ask").asDouble()) : "N/A",
                    node.has("lastPrice") ? String.format("%.2f", node.get("lastPrice").asDouble()) : "N/A");
        } catch (Exception e) {
            logger.warn("[BDD] Could not parse market data response: {}", e.getMessage());
        }
    }

    @When("I request market data for symbols {string}")
    public void iRequestMarketDataForSymbols(String symbols) {
        logger.info("[BDD] Requesting batch market data for symbols: {}", symbols);
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/marketdata/quotes?symbols=" + symbols, HttpMethod.GET, new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        try {
            JsonNode node = objectMapper.readTree(response.getBody());
            logger.info("[BDD] Batch market data returned {} entries", node.size());
        } catch (Exception e) {
            logger.warn("[BDD] Could not parse batch market data response: {}", e.getMessage());
        }
    }

    @And("the market data symbol is {string}")
    public void theMarketDataSymbolIs(String expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("symbol").asText()).isEqualTo(expected);
        logger.info("[BDD] Assertion passed: market data symbol = {}", expected);
    }

    @And("the market data has a bid price")
    public void theMarketDataHasABidPrice() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("bid")).isTrue();
        assertThat(node.get("bid").asDouble()).isGreaterThan(0);
        logger.info("[BDD] Assertion passed: bid = {}", node.get("bid").asDouble());
    }

    @And("the market data has an ask price")
    public void theMarketDataHasAnAskPrice() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("ask")).isTrue();
        assertThat(node.get("ask").asDouble()).isGreaterThan(0);
        logger.info("[BDD] Assertion passed: ask = {}", node.get("ask").asDouble());
    }

    @And("the market data has a last price")
    public void theMarketDataHasALastPrice() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("lastPrice")).isTrue();
        assertThat(node.get("lastPrice").asDouble()).isGreaterThan(0);
        logger.info("[BDD] Assertion passed: lastPrice = {}", node.get("lastPrice").asDouble());
    }

    @And("the ask price is greater than or equal to the bid price")
    public void theAskPriceIsGreaterThanOrEqualToTheBidPrice() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        double bid = node.get("bid").asDouble();
        double ask = node.get("ask").asDouble();
        assertThat(ask).isGreaterThanOrEqualTo(bid);
        logger.info("[BDD] Assertion passed: ask({}) >= bid({})", ask, bid);
    }

    @And("the market data response contains {int} entries")
    public void theMarketDataResponseContainsEntries(int expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.isArray()).isTrue();
        assertThat(node.size()).isEqualTo(expected);
        logger.info("[BDD] Assertion passed: market data batch contains {} entries", expected);
    }
}
