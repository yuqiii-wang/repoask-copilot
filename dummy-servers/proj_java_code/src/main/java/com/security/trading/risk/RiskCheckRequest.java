package com.security.trading.risk;

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
