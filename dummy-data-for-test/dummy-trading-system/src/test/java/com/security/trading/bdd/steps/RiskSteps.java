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

public class RiskSteps {

    private static final Logger logger = LogManager.getLogger(RiskSteps.class);

    @Autowired
    @Qualifier("bddRestTemplate")
    private RestTemplate restTemplate;

    @Autowired
    @Qualifier("bddAuthHeaders")
    private HttpHeaders authHeaders;

    @Autowired
    private ScenarioContext context;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private Map<String, Object> riskCheckRequest;
    private Map<String, Object> riskAssessmentRequest;

    @Given("I have a risk check request:")
    public void iHaveARiskCheckRequest(DataTable dataTable) {
        List<Map<String, String>> rows = dataTable.asMaps();
        Map<String, String> row = rows.get(0);
        riskCheckRequest = new HashMap<>();
        riskCheckRequest.put("tradeId", row.get("tradeId"));
        riskCheckRequest.put("tradeType", row.get("tradeType"));
        riskCheckRequest.put("tradeValue", Double.parseDouble(row.get("tradeValue")));
        riskCheckRequest.put("counterparty", row.get("counterparty"));
        riskCheckRequest.put("positionSize", Double.parseDouble(row.get("positionSize")));
        riskCheckRequest.put("price", Double.parseDouble(row.get("price")));
        riskCheckRequest.put("quantity", Integer.parseInt(row.get("quantity")));
        logger.info("[BDD] Risk check request prepared: tradeId={}, tradeValue={}, positionSize={}",
                row.get("tradeId"), row.get("tradeValue"), row.get("positionSize"));
    }

    @When("I submit the risk check")
    public void iSubmitTheRiskCheck() {
        logger.info("[BDD] Submitting risk check: {}", riskCheckRequest);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(riskCheckRequest, authHeaders);
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/risk/check", HttpMethod.POST, entity, String.class);
        context.setLastResponse(response);
        try {
            JsonNode node = objectMapper.readTree(response.getBody());
            logger.info("[BDD] Risk check result: tradeId={}, approved={}, riskScore={}",
                    node.has("tradeId") ? node.get("tradeId").asText() : "N/A",
                    node.has("approved") ? node.get("approved").asBoolean() : "N/A",
                    node.has("riskScore") ? node.get("riskScore").asDouble() : "N/A");
        } catch (Exception e) {
            logger.warn("[BDD] Could not parse risk check response: {}", e.getMessage());
        }
    }

    @And("the risk check result is approved")
    public void theRiskCheckResultIsApproved() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("approved").asBoolean()).isTrue();
        logger.info("[BDD] Assertion passed: risk check approved = true");
    }

    @And("the risk check result is rejected")
    public void theRiskCheckResultIsRejected() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("approved").asBoolean()).isFalse();
        logger.info("[BDD] Assertion passed: risk check rejected (approved = false)");
    }

    @And("the trade ID in response is {string}")
    public void theTradeIdInResponseIs(String expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("tradeId").asText()).isEqualTo(expected);
        logger.info("[BDD] Assertion passed: risk check tradeId = {}", expected);
    }

    @And("the rejection reason is provided")
    public void theRejectionReasonIsProvided() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("rejectionReason")).isTrue();
        assertThat(node.get("rejectionReason").asText()).isNotBlank();
        logger.info("[BDD] Assertion passed: rejection reason = {}", node.get("rejectionReason").asText());
    }

    @Given("I have a risk assessment request:")
    public void iHaveARiskAssessmentRequest(DataTable dataTable) {
        List<Map<String, String>> rows = dataTable.asMaps();
        Map<String, String> row = rows.get(0);
        riskAssessmentRequest = new HashMap<>();
        riskAssessmentRequest.put("portfolioId", row.get("portfolioId"));
        riskAssessmentRequest.put("portfolioValue", Double.parseDouble(row.get("portfolioValue")));
        riskAssessmentRequest.put("riskModel", row.get("riskModel"));
        riskAssessmentRequest.put("confidenceLevel", Double.parseDouble(row.get("confidenceLevel")));
        riskAssessmentRequest.put("timeHorizon", Integer.parseInt(row.get("timeHorizon")));
        logger.info("[BDD] Risk assessment request prepared: portfolioId={}, value={}, model={}",
                row.get("portfolioId"), row.get("portfolioValue"), row.get("riskModel"));
    }

    @When("I submit the risk assessment")
    public void iSubmitTheRiskAssessment() {
        logger.info("[BDD] Submitting risk assessment: {}", riskAssessmentRequest);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(riskAssessmentRequest, authHeaders);
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/risk/assess", HttpMethod.POST, entity, String.class);
        context.setLastResponse(response);
        try {
            JsonNode node = objectMapper.readTree(response.getBody());
            logger.info("[BDD] Risk assessment result: assessmentId={}, var99={}, var95={}",
                    node.has("assessmentId") ? node.get("assessmentId").asText() : "N/A",
                    node.has("var99") ? node.get("var99").asDouble() : "N/A",
                    node.has("var95") ? node.get("var95").asDouble() : "N/A");
        } catch (Exception e) {
            logger.warn("[BDD] Could not parse risk assessment response: {}", e.getMessage());
        }
    }

    @And("the assessment has a valid assessment ID")
    public void theAssessmentHasAValidAssessmentID() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("assessmentId")).isTrue();
        assertThat(node.get("assessmentId").asText()).isNotBlank();
        logger.info("[BDD] Assertion passed: assessmentId = {}", node.get("assessmentId").asText());
    }

    @And("the VaR 99 value is provided")
    public void theVaR99ValueIsProvided() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("var99")).isTrue();
        assertThat(node.get("var99").asDouble()).isGreaterThan(0);
        logger.info("[BDD] Assertion passed: VaR99 = {}", node.get("var99").asDouble());
    }

    @And("the VaR 95 value is provided")
    public void theVaR95ValueIsProvided() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("var95")).isTrue();
        assertThat(node.get("var95").asDouble()).isGreaterThan(0);
        logger.info("[BDD] Assertion passed: VaR95 = {}", node.get("var95").asDouble());
    }

    @Given("at least one risk assessment has been performed")
    public void atLeastOneRiskAssessmentHasBeenPerformed() {
        Map<String, Object> request = new HashMap<>();
        request.put("portfolioId", "PORT-SEED");
        request.put("portfolioValue", 500000.0);
        request.put("riskModel", "HISTORICAL");
        request.put("confidenceLevel", 0.95);
        request.put("timeHorizon", 1);
        restTemplate.exchange("/api/risk/assess", HttpMethod.POST,
                new HttpEntity<>(request, authHeaders), String.class);
        logger.info("[BDD] Precondition: performed a seed risk assessment for PORT-SEED");
    }

    @When("I request all risk assessments")
    public void iRequestAllRiskAssessments() {
        logger.info("[BDD] Requesting all risk assessments");
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/risk/assessments", HttpMethod.GET, new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        logger.info("[BDD] GET /api/risk/assessments returned HTTP {}", response.getStatusCode().value());
    }

    @And("the risk assessments list is not empty")
    public void theRiskAssessmentsListIsNotEmpty() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.isArray()).isTrue();
        assertThat(node.size()).isGreaterThan(0);
        logger.info("[BDD] Assertion passed: risk assessments list size = {}", node.size());
    }
}
