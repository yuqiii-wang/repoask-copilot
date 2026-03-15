package com.security.trading.ledger;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class PnLReport {
    private String reportId;
    private String period;
    private double totalPnL;
    private double realizedPnL;
    private double unrealizedPnL;
    private double tradingFees;
    private double netPnL;
    private LocalDateTime generatedAt;
}
