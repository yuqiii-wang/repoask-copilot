package com.security.trading.client.dto;

import lombok.Data;

/**
 * Request DTO sent to the external settlement gateway (e.g. DTCC / SWIFT mock).
 */
@Data
public class ExternalSettlementRequest {
    private String settlementId;
    private String tradeId;
    private String isin;
    private double amount;
    private String currency;
    private String counterparty;
    /** DTC | NSCC | SWIFT */
    private String settlementMethod;
    private String settlementDate;
}
