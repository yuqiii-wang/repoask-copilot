package com.security.trading.model.entity;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class MarketData {
    private String symbol;
    private double bid;
    private double ask;
    private double lastPrice;
    private int volume;
    private LocalDateTime timestamp;
    private String exchange;
    private double openPrice;
    private double highPrice;
    private double lowPrice;
    private double previousClose;
}
