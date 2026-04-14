package com.security.trading.client.dto;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * Response DTO from the external market data feed (e.g. Bloomberg / Reuters mock).
 */
@Data
public class ExternalMarketQuoteResponse {
    private String symbol;
    private String exchange;
    private double bid;
    private double ask;
    private double lastPrice;
    private double openPrice;
    private double highPrice;
    private double lowPrice;
    private double previousClose;
    private int volume;
    private LocalDateTime timestamp;
    /** OK | STALE | UNAVAILABLE */
    private String status;
}
