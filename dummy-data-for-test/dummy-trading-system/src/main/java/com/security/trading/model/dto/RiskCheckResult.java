package com.security.trading.model.dto;

import lombok.Data;

@Data
public class RiskCheckResult {
    private String tradeId;
    private boolean approved;
    private String riskStatus;
    private double riskScore;
    private String rejectionReason;
    private double maxPositionLimit;
    private double currentPosition;
}
