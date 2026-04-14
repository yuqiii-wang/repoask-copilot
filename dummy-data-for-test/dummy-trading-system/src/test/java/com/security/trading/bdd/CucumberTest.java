package com.security.trading.bdd;

import org.junit.platform.suite.api.ConfigurationParameter;
import org.junit.platform.suite.api.IncludeEngines;
import org.junit.platform.suite.api.SelectClasspathResource;
import org.junit.platform.suite.api.Suite;

import static io.cucumber.junit.platform.engine.Constants.GLUE_PROPERTY_NAME;
import static io.cucumber.junit.platform.engine.Constants.PLUGIN_PROPERTY_NAME;

@Suite
@IncludeEngines("cucumber")
@SelectClasspathResource("features")
@ConfigurationParameter(key = GLUE_PROPERTY_NAME, value = "com.security.trading.bdd")
@ConfigurationParameter(key = PLUGIN_PROPERTY_NAME,
        value = "pretty, json:target/cucumber-reports/cucumber.json, html:target/cucumber-reports/cucumber.html")
public class CucumberTest {
}
