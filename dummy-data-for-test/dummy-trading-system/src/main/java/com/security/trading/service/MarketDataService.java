package com.security.trading.service;

import com.security.trading.model.entity.MarketData;

public interface MarketDataService {
    MarketData getMarketData(String symbol);
    MarketData[] getMarketDataBatch(String[] symbols);
}
