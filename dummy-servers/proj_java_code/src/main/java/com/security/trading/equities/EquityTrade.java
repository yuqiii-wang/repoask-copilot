package com.security.trading.equities;

import com.security.trading.common.Trade;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class EquityTrade extends Trade {
    private String exchange;
    private String orderType; // MARKET, LIMIT, STOP
    private String timeInForce; // GTC, DAY, IOC
}
