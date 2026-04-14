package com.security.trading.model.dto;

import lombok.Data;

@Data
public class BondCalculationResult {
    private String isin;
    private double yieldToMaturity;
    private double duration;
    private double convexity;
    private double currentYield;
    private double cleanPrice;
    private double dirtyPrice;
}
