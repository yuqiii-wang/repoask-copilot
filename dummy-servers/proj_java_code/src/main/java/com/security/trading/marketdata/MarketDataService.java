package com.security.trading.marketdata;

import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class MarketDataService {
    
    private final ConcurrentHashMap<String, MarketData> marketDataCache = new ConcurrentHashMap<>();
    
    public MarketData getMarketData(String symbol) {
        // Check if data is in cache
        MarketData data = marketDataCache.get(symbol);
        if (data == null || data.getTimestamp().plusSeconds(30).isBefore(LocalDateTime.now())) {
            // Generate new market data
            data = generateMarketData(symbol);
            marketDataCache.put(symbol, data);
        }
        return data;
    }
    
    public MarketData[] getMarketDataBatch(String[] symbols) {
        MarketData[] results = new MarketData[symbols.length];
        for (int i = 0; i < symbols.length; i++) {
            results[i] = getMarketData(symbols[i]);
        }
        return results;
    }
    
    private MarketData generateMarketData(String symbol) {
        MarketData data = new MarketData();
        data.setSymbol(symbol);
        data.setTimestamp(LocalDateTime.now());
        
        // Generate random market data
        double basePrice = 100 + Math.random() * 900;
        data.setLastPrice(roundToTwoDecimals(basePrice));
        data.setBid(roundToTwoDecimals(basePrice - 0.01));
        data.setAsk(roundToTwoDecimals(basePrice + 0.01));
        data.setVolume((int)(1000 + Math.random() * 9000));
        data.setExchange("NYSE");
        data.setOpenPrice(roundToTwoDecimals(basePrice - 1 + Math.random() * 2));
        data.setHighPrice(roundToTwoDecimals(Math.max(data.getOpenPrice(), data.getLastPrice()) + Math.random()));
        data.setLowPrice(roundToTwoDecimals(Math.min(data.getOpenPrice(), data.getLastPrice()) - Math.random()));
        data.setPreviousClose(roundToTwoDecimals(basePrice - 0.5 + Math.random()));
        
        return data;
    }
    
    private double roundToTwoDecimals(double value) {
        return Math.round(value * 100) / 100.0;
    }
}
