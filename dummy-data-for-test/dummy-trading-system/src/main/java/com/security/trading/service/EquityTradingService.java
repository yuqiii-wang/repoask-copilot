package com.security.trading.service;

import com.security.trading.model.entity.EquityTrade;

import java.util.List;

public interface EquityTradingService {
    EquityTrade executeTrade(EquityTrade trade);
    List<EquityTrade> getTrades();
    EquityTrade getTrade(String tradeId);
}
