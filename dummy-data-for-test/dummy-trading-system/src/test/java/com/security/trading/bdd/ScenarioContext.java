package com.security.trading.bdd;

import io.cucumber.spring.ScenarioScope;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

/**
 * Scenario-scoped context for sharing state between Cucumber step definitions.
 * Automatically reset between scenarios.
 */
@Component
@ScenarioScope
public class ScenarioContext {

    private ResponseEntity<String> lastResponse;
    private String lastId;

    public ResponseEntity<String> getLastResponse() {
        return lastResponse;
    }

    public void setLastResponse(ResponseEntity<String> lastResponse) {
        this.lastResponse = lastResponse;
    }

    public String getLastId() {
        return lastId;
    }

    public void setLastId(String lastId) {
        this.lastId = lastId;
    }
}
