package com.security.trading.client;

import com.security.trading.client.dto.ExternalMarketQuoteResponse;
import com.security.trading.exception.DownstreamServerException;
import com.security.trading.exception.DownstreamTimeoutException;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;

import java.util.List;

/**
 * RestTemplate-based implementation of {@link MarketDataFeignClient}.
 * Calls the external market data feed via plain HTTP without the Spring Cloud
 * Feign autoconfiguration infrastructure (which is incompatible with
 * Spring Boot 4.0 due to relocated internal classes).
 */
@Component
public class MarketDataRestClient implements MarketDataFeignClient {

    private static final Logger logger = LogManager.getLogger(MarketDataRestClient.class);

    private final RestTemplate restTemplate;
    private final String baseUrl;

    public MarketDataRestClient(
            @Value("${feign.client.market-data.url}") String baseUrl) {
        this.restTemplate = new RestTemplate();
        this.baseUrl = baseUrl;
    }

    @Override
    public ExternalMarketQuoteResponse getQuote(String symbol) {
        String url = baseUrl + "/api/v1/quotes/" + symbol;
        logger.debug("[MarketData] GET {}", url);
        try {
            ResponseEntity<ExternalMarketQuoteResponse> resp = restTemplate.exchange(
                    url, HttpMethod.GET, HttpEntity.EMPTY, ExternalMarketQuoteResponse.class);
            return resp.getBody();
        } catch (ResourceAccessException e) {
            logger.warn("[MarketData] Timeout reaching market-data feed: {}", e.getMessage());
            throw new DownstreamTimeoutException("Market data feed timed out: " + e.getMessage());
        } catch (RestClientResponseException e) {
            logger.warn("[MarketData] Server error from market-data feed: HTTP {}", e.getStatusCode());
            throw new DownstreamServerException("Market data feed error: " + e.getMessage());
        }
    }

    @Override
    public List<ExternalMarketQuoteResponse> getQuoteBatch(List<String> symbols) {
        String url = baseUrl + "/api/v1/quotes/batch";
        logger.debug("[MarketData] POST {} symbols={}", url, symbols);
        try {
            ResponseEntity<List<ExternalMarketQuoteResponse>> resp = restTemplate.exchange(
                    url, HttpMethod.POST, new HttpEntity<>(symbols),
                    new ParameterizedTypeReference<>() {});
            return resp.getBody();
        } catch (ResourceAccessException e) {
            logger.warn("[MarketData] Timeout reaching market-data feed: {}", e.getMessage());
            throw new DownstreamTimeoutException("Market data feed timed out: " + e.getMessage());
        } catch (RestClientResponseException e) {
            logger.warn("[MarketData] Server error from market-data feed: HTTP {}", e.getStatusCode());
            throw new DownstreamServerException("Market data feed error: " + e.getMessage());
        }
    }
}
