package com.security.trading.model.entity;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class RiskAssessment {
    private String assessmentId;
    private String portfolioId;
    private double var99;
    private double var95;
    private double stressTestResult;
    private double counterpartyRisk;
    private boolean limitBreached;
    private String breachReason;
    private LocalDateTime assessmentTime;
}
