package com.security.trading.oms;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class Order {
    private String orderId;
    private String tradeId;
    private String symbol;
    private int quantity;
    private double price;
    private String side; // BUY, SELL
    private String orderType; // MARKET, LIMIT, STOP
    private String timeInForce; // GTC, DAY, IOC
    private String status; // PENDING, EXECUTED, PARTIALLY_EXECUTED, CANCELLED
    private int filledQuantity;
    private Double averagePrice;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private String routingInstructions;
    private String algorithm; // VWAP, TWAP, etc.
}
