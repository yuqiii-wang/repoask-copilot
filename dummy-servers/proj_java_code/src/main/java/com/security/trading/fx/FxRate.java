package com.security.trading.fx;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class FxRate {
    private String currencyPair;
    private double bid;
    private double ask;
    private double mid;
    private LocalDateTime timestamp;
    private String source;
}
