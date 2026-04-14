package com.security.trading.service;

import com.security.trading.model.entity.FxRate;
import com.security.trading.model.entity.FxTrade;

import java.util.List;

public interface FxService {
    FxTrade executeTrade(FxTrade trade);
    FxRate getExchangeRate(String currencyPair);
    List<FxTrade> getTrades();
    FxTrade getTrade(String tradeId);
}
