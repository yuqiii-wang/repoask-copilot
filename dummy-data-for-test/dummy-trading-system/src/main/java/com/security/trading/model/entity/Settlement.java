package com.security.trading.model.entity;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class Settlement {
    private String settlementId;
    private String tradeId;
    private String status; // PENDING, PROCESSED, FAILED
    private String settlementDate;
    private double settlementAmount;
    private String currency;
    private String isin;
    private String counterparty;
    private String settlementMethod; // DTC, NSCC, SWIFT
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private String failureReason;
}
