package com.security.trading.model.entity;

import com.security.trading.model.entity.Trade;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class FxTrade extends Trade {
    private String currencyPair;
    private String tradeType; // SPOT, FORWARD, SWAP
    private String settlementDate;
    private double exchangeRate;
    private String baseCurrency;
    private String quoteCurrency;
}
