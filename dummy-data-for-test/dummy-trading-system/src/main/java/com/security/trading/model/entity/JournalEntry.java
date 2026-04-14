package com.security.trading.model.entity;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class JournalEntry {
    private String entryId;
    private String tradeId;
    private String account;
    private double debit;
    private double credit;
    private String currency;
    private String description;
    private LocalDateTime timestamp;
    private String entryType; // TRADE, SETTLEMENT, FEE
}
