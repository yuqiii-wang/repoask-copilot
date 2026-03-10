---
name: behavior-driven-development
description: Behavior-Driven Development with Cucumber and Given-When-Then scenarios
user-invocable: false
---

# Behavior-Driven Development (BDD) Skill

## When to Use
- Defining acceptance criteria and executable specifications.
- Translating requirements into testable Given-When-Then scenarios.
- Implementing end-to-end tests using the **Cucumber** framework.

## BDD Process with Cucumber
BDD uses natural language scenarios (Gherkin syntax) that become executable tests via Cucumber step definitions. Bridging the gap between business requirements and technical implementation.

### 1. Scenario Definition (Gherkin)
Write business-readable scenarios in `src/test/resources/cucumber/*.feature` files:

```gherkin
Feature: User Authentication

  Scenario: Successful login with valid credentials
    Given a registered user with email "user@example.com"
    When the user submits the login form with valid credentials
    Then the dashboard should be displayed
```

### 2. Step Definitions (Cucumber)
Implement the executable Cucumber glue code, constructing the path from the source input as much as possible:

```java
import io.cucumber.java.en.Given;
import io.cucumber.java.en.When;
import io.cucumber.java.en.Then;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class LoginSteps {

    @Given("a registered user with email {string}")
    public void a_registered_user_with_email(String email) {
        // Implementation logic to create user
    }

    @When("the user submits the login form with valid credentials")
    public void submit_login_form_with_valid_credentials() {
        // Implementation logic for login
    }

    @Then("the dashboard should be displayed")
    public void the_dashboard_should_be_displayed() {
        assertTrue(Driver.getCurrentUrl().contains("/dashboard"));
    }
}
```

Cucumber context run as

```java
@RunWith(Cucumber.class)
@CucumberOptions(
  features = "src/test/resources/cucumber/<feature-name>.feature",
  glue = "test.cucumber",
  plugin = {"pretty",
            "html:target/cucumber-report.html",
            "json:target/cucumber/cucumber-report.json"}
)

public class <feature-name>CucumberTest {}
```

## Best Practices
- **Focus on Behavior:** Write from the user's perspective what the src input would be, avoiding technical implementation details.
- **Keep it Concise:** Limit scenarios to essential steps. 
- **Independent Scenarios:** Ensure tests don't depend on state from other scenarios.
- **Automation:** Use Cucumber to strictly bind feature specifications to executable tests.

## Output Format
- **Features:** Save standard Gherkin to `src/test/resources/cucumber/<feature-name>.feature`
- **Steps:** Construct the implementation file path from the `src` input as much as possible, mapping the feature location to the matching step definitions structure (e.g. `src/test/java/cucumber/<FeatureName>Steps.java`).
