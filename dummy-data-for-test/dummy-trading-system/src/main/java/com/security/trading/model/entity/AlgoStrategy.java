package com.security.trading.model.entity;

import lombok.Data;

@Data
public class AlgoStrategy {
    private String strategyId;
    private String name;
    private String type; // VWAP, TWAP, ARBITRAGE
    private String status; // ACTIVE, INACTIVE
    private String parameters;
    private String description;
    // Number of historical bars available for backtesting (minimum 252 required for activation)
    private int minBarsAvailable;
    // Optional trading window, e.g. "09:30:00-15:30:00"
    private String tradingWindow;
}
