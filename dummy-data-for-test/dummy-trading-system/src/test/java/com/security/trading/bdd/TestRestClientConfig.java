package com.security.trading.bdd;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.support.HttpRequestWrapper;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriTemplateHandler;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

@Configuration
public class TestRestClientConfig {

    @Value("${server.port:8080}")
    private int serverPort;

    @Value("${server.servlet.context-path:/trading-system}")
    private String contextPath;

    @Bean("bddRestTemplate")
    public RestTemplate bddRestTemplate() {
        final String baseUrl = "http://localhost:" + serverPort + contextPath;
        final String authValue = "Basic " +
                Base64.getEncoder().encodeToString("user:password".getBytes(StandardCharsets.ISO_8859_1));

        RestTemplate template = new RestTemplate();

        // Resolve relative paths like /api/... against the base URL (simple concatenation)
        template.setUriTemplateHandler(new UriTemplateHandler() {
            @Override
            public URI expand(String uriTemplate, Map<String, ?> uriVariables) {
                return toUri(uriTemplate);
            }

            @Override
            public URI expand(String uriTemplate, Object... uriVariables) {
                return toUri(uriTemplate);
            }

            private URI toUri(String tpl) {
                if (tpl.startsWith("http://") || tpl.startsWith("https://")) {
                    return URI.create(tpl);
                }
                return URI.create(baseUrl + (tpl.startsWith("/") ? tpl : "/" + tpl));
            }
        });

        // Always inject Authorization header so every request is authenticated
        template.getInterceptors().add((request, body, execution) ->
                execution.execute(new HttpRequestWrapper(request) {
                    @Override
                    public HttpHeaders getHeaders() {
                        HttpHeaders combined = new HttpHeaders();
                        combined.putAll(super.getHeaders());
                        combined.set(HttpHeaders.AUTHORIZATION, authValue);
                        combined.setContentType(MediaType.APPLICATION_JSON);
                        return combined;
                    }
                }, body)
        );

        return template;
    }

    /**
     * Pre-built auth headers for use in HttpEntity construction in step definitions.
     */
    @Bean("bddAuthHeaders")
    public HttpHeaders bddAuthHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBasicAuth("user", "password");
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }
}

