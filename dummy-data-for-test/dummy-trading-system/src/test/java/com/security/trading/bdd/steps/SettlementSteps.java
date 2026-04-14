package com.security.trading.bdd.steps;

import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.security.trading.bdd.ScenarioContext;
import io.cucumber.datatable.DataTable;
import io.cucumber.java.en.And;
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

public class SettlementSteps {

    private static final Logger logger = LogManager.getLogger(SettlementSteps.class);

    @Autowired
    @Qualifier("bddRestTemplate")
    private RestTemplate restTemplate;

    @Autowired
    @Qualifier("bddAuthHeaders")
    private HttpHeaders authHeaders;

    @Autowired
    private ScenarioContext context;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @When("I create a settlement with:")
    public void iCreateASettlementWith(DataTable dataTable) {
        List<Map<String, String>> rows = dataTable.asMaps();
        Map<String, String> row = rows.get(0);
        Map<String, Object> body = new HashMap<>();
        body.put("tradeId", row.get("tradeId"));
        body.put("isin", row.get("isin"));
        body.put("settlementAmount", Double.parseDouble(row.get("settlementAmount")));
        body.put("currency", row.get("currency"));
        body.put("counterparty", row.get("counterparty"));
        body.put("settlementMethod", row.get("settlementMethod"));
        body.put("settlementDate", row.get("settlementDate"));
        logger.info("[BDD] Creating settlement: tradeId={}, isin={}, amount={}", 
                row.get("tradeId"), row.get("isin"), row.get("settlementAmount"));
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/settlement/create", HttpMethod.POST,
                new HttpEntity<>(body, authHeaders), String.class);
        context.setLastResponse(response);
        try {
            JsonNode node = objectMapper.readTree(response.getBody());
            if (node.has("settlementId")) {
                context.setLastId(node.get("settlementId").asText());
                logger.info("[BDD] Settlement created: settlementId={}, status={}",
                        node.get("settlementId").asText(),
                        node.has("status") ? node.get("status").asText() : "N/A");
            }
        } catch (Exception e) {
            logger.warn("[BDD] Could not parse settlement create response: {}", e.getMessage());
        }
    }

    @When("I process the settlement")
    public void iProcessTheSettlement() {
        String settlementId = context.getLastId();
        logger.info("[BDD] Processing settlement: id={}", settlementId);
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/settlement/process/" + settlementId, HttpMethod.PUT,
                new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        try {
            JsonNode node = objectMapper.readTree(response.getBody());
            logger.info("[BDD] Settlement processed: id={}, status={}",
                    settlementId,
                    node.has("status") ? node.get("status").asText() : "N/A");
        } catch (Exception e) {
            logger.warn("[BDD] Could not parse settlement process response: {}", e.getMessage());
        }
    }

    @When("I request all settlements")
    public void iRequestAllSettlements() {
        logger.info("[BDD] Requesting all settlements");
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/settlement/settlements", HttpMethod.GET,
                new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        logger.info("[BDD] GET /api/settlement/settlements returned HTTP {}", response.getStatusCode().value());
    }

    @When("I request settlements for trade {string}")
    public void iRequestSettlementsForTrade(String tradeId) {
        logger.info("[BDD] Requesting settlements for trade: {}", tradeId);
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/settlement/settlements/trade/" + tradeId, HttpMethod.GET,
                new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        logger.info("[BDD] GET /api/settlement/settlements/trade/{} returned HTTP {}", tradeId, response.getStatusCode().value());
    }

    @And("the settlement has a valid settlement ID")
    public void theSettlementHasAValidSettlementID() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("settlementId")).isTrue();
        assertThat(node.get("settlementId").asText()).isNotBlank();
        logger.info("[BDD] Assertion passed: settlementId = {}", node.get("settlementId").asText());
    }

    @And("the settlement status is {string}")
    public void theSettlementStatusIs(String expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("status").asText()).isEqualTo(expected);
        logger.info("[BDD] Assertion passed: settlement status = {}", expected);
    }

    @And("the settlement status is processed or failed")
    public void theSettlementStatusIsProcessedOrFailed() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        String status = node.get("status").asText();
        assertThat(status).isIn("PROCESSED", "FAILED");
        logger.info("[BDD] Assertion passed: settlement status = {} (PROCESSED or FAILED)", status);
    }

    @And("the response contains a list of settlements")
    public void theResponseContainsAListOfSettlements() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.isArray()).isTrue();
        logger.info("[BDD] Assertion passed: response is an array with {} settlements", node.size());
    }

    @And("the settlement list contains trade {string}")
    public void theSettlementListContainsTrade(String tradeId) throws Exception {
        JsonNode array = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(array.isArray()).isTrue();
        boolean found = false;
        for (JsonNode item : array) {
            if (tradeId.equals(item.path("tradeId").asText())) {
                found = true;
                break;
            }
        }
        assertThat(found).as("Expected settlement list to contain tradeId=%s", tradeId).isTrue();
        logger.info("[BDD] Assertion passed: settlement list contains tradeId={}", tradeId);
    }
}
