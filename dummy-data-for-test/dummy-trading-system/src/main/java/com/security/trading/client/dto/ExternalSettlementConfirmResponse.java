package com.security.trading.client.dto;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * Confirmation response from the external settlement gateway (e.g. DTCC / SWIFT mock).
 */
@Data
public class ExternalSettlementConfirmResponse {
    /** Reference number assigned by the clearing house. */
    private String externalRef;
    private String settlementId;
    /** CONFIRMED | PENDING | REJECTED */
    private String status;
    private String rejectionReason;
    private double settledAmount;
    private String currency;
    private LocalDateTime confirmedAt;
    /** DTC | NSCC | SWIFT */
    private String clearingHouse;
}
