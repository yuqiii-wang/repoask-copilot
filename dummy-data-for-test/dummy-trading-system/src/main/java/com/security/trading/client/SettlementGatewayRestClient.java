package com.security.trading.client;

import com.security.trading.client.dto.ExternalSettlementConfirmResponse;
import com.security.trading.client.dto.ExternalSettlementRequest;
import com.security.trading.exception.DownstreamServerException;
import com.security.trading.exception.DownstreamTimeoutException;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;

/**
 * RestTemplate-based implementation of {@link SettlementGatewayFeignClient}.
 * Calls the external clearing gateway via plain HTTP without the Spring Cloud
 * Feign autoconfiguration infrastructure (which is incompatible with
 * Spring Boot 4.0 due to relocated internal classes).
 */
@Component
public class SettlementGatewayRestClient implements SettlementGatewayFeignClient {

    private static final Logger logger = LogManager.getLogger(SettlementGatewayRestClient.class);

    private final RestTemplate restTemplate;
    private final String baseUrl;

    public SettlementGatewayRestClient(
            @Value("${feign.client.settlement-gateway.url}") String baseUrl) {
        this.restTemplate = new RestTemplate();
        this.baseUrl = baseUrl;
    }

    @Override
    public ExternalSettlementConfirmResponse confirmSettlement(ExternalSettlementRequest request) {
        String url = baseUrl + "/api/v1/settlements/confirm";
        logger.debug("[Settlement] POST {} settlementId={}", url, request.getSettlementId());
        try {
            ResponseEntity<ExternalSettlementConfirmResponse> resp = restTemplate.exchange(
                    url, HttpMethod.POST, new HttpEntity<>(request),
                    ExternalSettlementConfirmResponse.class);
            return resp.getBody();
        } catch (ResourceAccessException e) {
            logger.warn("[Settlement] Timeout reaching settlement gateway: {}", e.getMessage());
            throw new DownstreamTimeoutException("Settlement gateway timed out: " + e.getMessage());
        } catch (RestClientResponseException e) {
            logger.warn("[Settlement] Server error from settlement gateway: HTTP {}", e.getStatusCode());
            throw new DownstreamServerException("Settlement gateway error: " + e.getMessage());
        }
    }

    @Override
    public ExternalSettlementConfirmResponse getSettlementStatus(String externalRef) {
        String url = baseUrl + "/api/v1/settlements/" + externalRef + "/status";
        logger.debug("[Settlement] GET {}", url);
        try {
            ResponseEntity<ExternalSettlementConfirmResponse> resp = restTemplate.exchange(
                    url, HttpMethod.GET, HttpEntity.EMPTY,
                    ExternalSettlementConfirmResponse.class);
            return resp.getBody();
        } catch (ResourceAccessException e) {
            logger.warn("[Settlement] Timeout reaching settlement gateway: {}", e.getMessage());
            throw new DownstreamTimeoutException("Settlement gateway timed out: " + e.getMessage());
        } catch (RestClientResponseException e) {
            logger.warn("[Settlement] Server error from settlement gateway: HTTP {}", e.getStatusCode());
            throw new DownstreamServerException("Settlement gateway error: " + e.getMessage());
        }
    }
}
