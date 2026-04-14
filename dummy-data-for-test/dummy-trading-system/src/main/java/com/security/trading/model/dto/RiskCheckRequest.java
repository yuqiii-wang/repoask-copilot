package com.security.trading.model.dto;

import lombok.Data;

@Data
public class RiskCheckRequest {
    private String tradeId;
    private String tradeType;
    private double tradeValue;
    private String counterparty;
    private double positionSize;
    private double price;
    private int quantity;
}
