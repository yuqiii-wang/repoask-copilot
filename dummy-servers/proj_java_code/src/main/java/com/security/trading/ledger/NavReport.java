package com.security.trading.ledger;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class NavReport {
    private String reportId;
    private double totalAssets;
    private double totalLiabilities;
    private double netAssetValue;
    private int totalShares;
    private double navPerShare;
    private LocalDateTime calculatedAt;
}
