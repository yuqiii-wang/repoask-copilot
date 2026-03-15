package com.security.trading.algo;

import lombok.Data;

@Data
public class AlgoStrategy {
    private String strategyId;
    private String name;
    private String type; // VWAP, TWAP, ARBITRAGE
    private String status; // ACTIVE, INACTIVE
    private String parameters;
    private String description;
}
