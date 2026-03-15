package com.security.trading.risk;

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
