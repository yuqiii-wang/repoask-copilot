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

public class LedgerSteps {

    private static final Logger logger = LogManager.getLogger(LedgerSteps.class);

    @Autowired
    @Qualifier("bddRestTemplate")
    private RestTemplate restTemplate;

    @Autowired
    @Qualifier("bddAuthHeaders")
    private HttpHeaders authHeaders;

    @Autowired
    private ScenarioContext context;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @When("I create a journal entry:")
    public void iCreateAJournalEntry(DataTable dataTable) {
        List<Map<String, String>> rows = dataTable.asMaps();
        Map<String, String> row = rows.get(0);
        Map<String, Object> body = new HashMap<>();
        body.put("tradeId", row.get("tradeId"));
        body.put("account", row.get("account"));
        body.put("debit", Double.parseDouble(row.get("debit")));
        body.put("credit", Double.parseDouble(row.get("credit")));
        body.put("currency", row.get("currency"));
        body.put("description", row.get("description"));
        body.put("entryType", row.get("entryType"));
        logger.info("[BDD] Creating journal entry: tradeId={}, account={}, debit={}, credit={}",
                row.get("tradeId"), row.get("account"), row.get("debit"), row.get("credit"));
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/ledger/entry", HttpMethod.POST,
                new HttpEntity<>(body, authHeaders), String.class);
        context.setLastResponse(response);
        try {
            JsonNode node = objectMapper.readTree(response.getBody());
            if (node.has("entryId")) {
                context.setLastId(node.get("entryId").asText());
                logger.info("[BDD] Journal entry created: entryId={}, tradeId={}",
                        node.get("entryId").asText(), row.get("tradeId"));
            }
        } catch (Exception e) {
            logger.warn("[BDD] Could not parse journal entry response: {}", e.getMessage());
        }
    }

    @Given("at least one journal entry has been created")
    public void atLeastOneJournalEntryHasBeenCreated() {
        Map<String, Object> body = new HashMap<>();
        body.put("tradeId", "TRD-SEED-001");
        body.put("account", "EQUITY_DESK");
        body.put("debit", 1000.00);
        body.put("credit", 1000.00);
        body.put("currency", "USD");
        body.put("description", "Seed journal entry for tests");
        body.put("entryType", "TRADE");
        restTemplate.exchange("/api/ledger/entry", HttpMethod.POST,
                new HttpEntity<>(body, authHeaders), String.class);
        logger.info("[BDD] Precondition: created seed journal entry for TRD-SEED-001");
    }

    @Given("I have created a journal entry for trade {string}")
    public void iHaveCreatedAJournalEntryForTrade(String tradeId) {
        Map<String, Object> body = new HashMap<>();
        body.put("tradeId", tradeId);
        body.put("account", "FX_DESK");
        body.put("debit", 2500.00);
        body.put("credit", 2500.00);
        body.put("currency", "USD");
        body.put("description", "Pre-condition entry for " + tradeId);
        body.put("entryType", "TRADE");
        restTemplate.exchange("/api/ledger/entry", HttpMethod.POST,
                new HttpEntity<>(body, authHeaders), String.class);
        logger.info("[BDD] Pre-condition journal entry created for trade: {}", tradeId);
    }

    @When("I request all journal entries")
    public void iRequestAllJournalEntries() {
        logger.info("[BDD] Requesting all journal entries");
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/ledger/entries", HttpMethod.GET, new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        logger.info("[BDD] GET /api/ledger/entries returned HTTP {}", response.getStatusCode().value());
    }

    @When("I request journal entries for trade {string}")
    public void iRequestJournalEntriesForTrade(String tradeId) {
        logger.info("[BDD] Requesting journal entries for trade: {}", tradeId);
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/ledger/entries/trade/" + tradeId, HttpMethod.GET,
                new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        logger.info("[BDD] GET /api/ledger/entries/trade/{} returned HTTP {}", tradeId, response.getStatusCode().value());
    }

    @When("I request a PnL report for period {string}")
    public void iRequestAPnLReportForPeriod(String period) {
        logger.info("[BDD] Requesting PnL report for period: {}", period);
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/ledger/pnl?period=" + period, HttpMethod.GET,
                new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        logger.info("[BDD] GET /api/ledger/pnl?period={} returned HTTP {}", period, response.getStatusCode().value());
    }

    @When("I request the NAV report")
    public void iRequestTheNavReport() {
        logger.info("[BDD] Requesting NAV report");
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/ledger/nav", HttpMethod.GET, new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        logger.info("[BDD] GET /api/ledger/nav returned HTTP {}", response.getStatusCode().value());
    }

    @And("the journal entry has a valid entry ID")
    public void theJournalEntryHasAValidEntryID() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("entryId")).isTrue();
        assertThat(node.get("entryId").asText()).isNotBlank();
        logger.info("[BDD] Assertion passed: entryId = {}", node.get("entryId").asText());
    }

    @And("the journal entry is stored")
    public void theJournalEntryIsStored() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("entryId")).isTrue();
        logger.info("[BDD] Assertion passed: journal entry is stored with id = {}", node.get("entryId").asText());
    }

    @And("the response contains a list of journal entries")
    public void theResponseContainsAListOfJournalEntries() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.isArray()).isTrue();
        logger.info("[BDD] Assertion passed: response is an array with {} journal entries", node.size());
    }

    @And("the journal entry list contains trade {string}")
    public void theJournalEntryListContainsTrade(String tradeId) throws Exception {
        JsonNode array = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(array.isArray()).isTrue();
        boolean found = false;
        for (JsonNode item : array) {
            if (tradeId.equals(item.path("tradeId").asText())) {
                found = true;
                break;
            }
        }
        assertThat(found).as("Expected journal entries to contain tradeId=%s", tradeId).isTrue();
        logger.info("[BDD] Assertion passed: journal entry list contains tradeId={}", tradeId);
    }

    @And("the PnL report has a valid report ID")
    public void thePnLReportHasAValidReportID() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("reportId")).isTrue();
        assertThat(node.get("reportId").asText()).isNotBlank();
        logger.info("[BDD] Assertion passed: PnL reportId = {}", node.get("reportId").asText());
    }

    @And("the PnL report total PnL is greater than zero")
    public void thePnLReportTotalPnLIsGreaterThanZero() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("totalPnL")).isTrue();
        assertThat(node.get("totalPnL").asDouble()).isGreaterThan(0);
        logger.info("[BDD] Assertion passed: totalPnL = {}", node.get("totalPnL").asDouble());
    }

    @And("the NAV report has a valid report ID")
    public void theNavReportHasAValidReportID() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("reportId")).isTrue();
        assertThat(node.get("reportId").asText()).isNotBlank();
        logger.info("[BDD] Assertion passed: NAV reportId = {}", node.get("reportId").asText());
    }

    @And("the NAV per share is greater than zero")
    public void theNavPerShareIsGreaterThanZero() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("navPerShare")).isTrue();
        assertThat(node.get("navPerShare").asDouble()).isGreaterThan(0);
        logger.info("[BDD] Assertion passed: NAV per share = {}", node.get("navPerShare").asDouble());
    }
}
