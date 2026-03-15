package com.security.trading.algo;

import lombok.Data;

@Data
public class BacktestRequest {
    private String strategyId;
    private String symbol;
    private String startDate;
    private String endDate;
    private double initialCapital;
    private String parameters;
}
