package com.security.trading.client;

import com.security.trading.client.dto.ExternalMarketQuoteResponse;

import java.util.List;

/**
 * Contract for the external market data feed provider (Bloomberg / Reuters mock).
 * Implementations call the remote feed via HTTP.
 */
public interface MarketDataFeignClient {

    ExternalMarketQuoteResponse getQuote(String symbol);

    List<ExternalMarketQuoteResponse> getQuoteBatch(List<String> symbols);
}
