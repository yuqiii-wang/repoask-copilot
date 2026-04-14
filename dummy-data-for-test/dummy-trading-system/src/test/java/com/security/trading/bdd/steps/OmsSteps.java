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

public class OmsSteps {

    private static final Logger logger = LogManager.getLogger(OmsSteps.class);

    @Autowired
    @Qualifier("bddRestTemplate")
    private RestTemplate restTemplate;

    @Autowired
    @Qualifier("bddAuthHeaders")
    private HttpHeaders authHeaders;

    @Autowired
    private ScenarioContext context;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private Map<String, Object> orderRequest;

    @Given("I have an order request:")
    public void iHaveAnOrderRequest(DataTable dataTable) {
        List<Map<String, String>> rows = dataTable.asMaps();
        Map<String, String> row = rows.get(0);
        orderRequest = new HashMap<>();
        orderRequest.put("symbol", row.get("symbol"));
        orderRequest.put("quantity", Integer.parseInt(row.get("quantity")));
        orderRequest.put("price", Double.parseDouble(row.get("price")));
        orderRequest.put("side", row.get("side"));
        orderRequest.put("orderType", row.get("orderType"));
        orderRequest.put("timeInForce", row.get("timeInForce"));
        logger.info("[BDD] OMS order request prepared: symbol={}, qty={}, price={}, side={}, type={}",
                row.get("symbol"), row.get("quantity"), row.get("price"),
                row.get("side"), row.get("orderType"));
    }

    @Given("I have an order request with no symbol:")
    public void iHaveAnOrderRequestWithNoSymbol(DataTable dataTable) {
        List<Map<String, String>> rows = dataTable.asMaps();
        Map<String, String> row = rows.get(0);
        orderRequest = new HashMap<>();
        orderRequest.put("quantity", Integer.parseInt(row.get("quantity")));
        orderRequest.put("price", Double.parseDouble(row.get("price")));
        orderRequest.put("side", row.get("side"));
        orderRequest.put("orderType", row.get("orderType"));
        logger.info("[BDD] OMS invalid order request prepared (missing symbol)");
    }

    @When("I submit the order")
    public void iSubmitTheOrder() {
        logger.info("[BDD] Submitting OMS order: {}", orderRequest);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(orderRequest, authHeaders);
        try {
            ResponseEntity<String> response = restTemplate.exchange(
                    "/api/oms/order", HttpMethod.POST, entity, String.class);
            context.setLastResponse(response);
            JsonNode node = objectMapper.readTree(response.getBody());
            if (node.has("orderId")) {
                context.setLastId(node.get("orderId").asText());
                logger.info("[BDD] OMS order submitted: orderId={}, routing={}",
                        node.get("orderId").asText(),
                        node.has("routingInstructions") ? node.get("routingInstructions").asText() : "N/A");
            }
        } catch (HttpClientErrorException e) {
            // Capture 4xx errors in context for assertion
            ResponseEntity<String> errorResponse = ResponseEntity
                    .status(e.getStatusCode())
                    .body(e.getResponseBodyAsString());
            context.setLastResponse(errorResponse);
            logger.info("[BDD] OMS order rejected with HTTP {}: {}", e.getStatusCode().value(), e.getMessage());
        } catch (Exception e) {
            logger.error("[BDD] Unexpected error submitting order: {}", e.getMessage());
        }
    }

    @And("the order has a valid order ID")
    public void theOrderHasAValidOrderID() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.has("orderId")).isTrue();
        assertThat(node.get("orderId").asText()).isNotBlank();
        logger.info("[BDD] Assertion passed: orderId = {}", node.get("orderId").asText());
    }

    @And("the order routing is {string}")
    public void theOrderRoutingIs(String expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("routingInstructions").asText()).isEqualTo(expected);
        logger.info("[BDD] Assertion passed: routing = {}", expected);
    }

    @And("the order routing contains {string}")
    public void theOrderRoutingContains(String expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("routingInstructions").asText()).contains(expected);
        logger.info("[BDD] Assertion passed: routing contains '{}'", expected);
    }

    @Given("I have submitted an order for {string} with quantity {int} at price {double}")
    public void iHaveSubmittedAnOrderForWithQuantityAtPrice(String symbol, int qty, double price) {
        Map<String, Object> order = new HashMap<>();
        order.put("symbol", symbol);
        order.put("quantity", qty);
        order.put("price", price);
        order.put("side", "BUY");
        order.put("orderType", "LIMIT");
        order.put("timeInForce", "DAY");
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/oms/order", HttpMethod.POST,
                new HttpEntity<>(order, authHeaders), String.class);
        try {
            JsonNode node = objectMapper.readTree(response.getBody());
            if (node.has("orderId")) {
                context.setLastId(node.get("orderId").asText());
                logger.info("[BDD] Pre-submitted order: symbol={}, orderId={}", symbol, node.get("orderId").asText());
            }
        } catch (Exception e) {
            logger.warn("[BDD] Could not extract orderId: {}", e.getMessage());
        }
    }

    @When("I cancel the order by its ID")
    public void iCancelTheOrderByItsId() {
        String orderId = context.getLastId();
        logger.info("[BDD] Cancelling order: orderId={}", orderId);
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/oms/order/" + orderId + "/cancel", HttpMethod.PUT, new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        logger.info("[BDD] Cancel order returned HTTP {}", response.getStatusCode().value());
    }

    @And("the order status is {string}")
    public void theOrderStatusIs(String expected) throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.get("status").asText()).isEqualTo(expected);
        logger.info("[BDD] Assertion passed: order status = {}", expected);
    }

    @Given("at least one order has been created")
    public void atLeastOneOrderHasBeenCreated() {
        Map<String, Object> order = new HashMap<>();
        order.put("symbol", "VTI");
        order.put("quantity", 20);
        order.put("price", 240.00);
        order.put("side", "BUY");
        order.put("orderType", "LIMIT");
        order.put("timeInForce", "GTC");
        restTemplate.exchange("/api/oms/order", HttpMethod.POST,
                new HttpEntity<>(order, authHeaders), String.class);
        logger.info("[BDD] Precondition: created a seed OMS order for VTI");
    }

    @When("I request all orders")
    public void iRequestAllOrders() {
        logger.info("[BDD] Requesting all OMS orders");
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/oms/orders", HttpMethod.GET, new HttpEntity<>(authHeaders), String.class);
        context.setLastResponse(response);
        logger.info("[BDD] GET /api/oms/orders returned HTTP {}", response.getStatusCode().value());
    }

    @And("the orders list is not empty")
    public void theOrdersListIsNotEmpty() throws Exception {
        JsonNode node = objectMapper.readTree(context.getLastResponse().getBody());
        assertThat(node.isArray()).isTrue();
        assertThat(node.size()).isGreaterThan(0);
        logger.info("[BDD] Assertion passed: orders list size = {}", node.size());
    }
}
