package com.security.trading.model.entity;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public abstract class Trade {
    private String tradeId;
    private String symbol;
    private int quantity;
    private double price;
    private String side;
    private LocalDateTime timestamp;
    private String status;
    private int filledQuantity;
    private Double averagePrice;
}
