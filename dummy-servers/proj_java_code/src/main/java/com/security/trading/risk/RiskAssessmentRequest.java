package com.security.trading.risk;

import lombok.Data;

@Data
public class RiskAssessmentRequest {
    private String portfolioId;
    private double portfolioValue;
    private String riskModel; // VAR, HISTORICAL, MONTE_CARLO
    private double confidenceLevel; // 95, 99
    private int timeHorizon; // in days
}
