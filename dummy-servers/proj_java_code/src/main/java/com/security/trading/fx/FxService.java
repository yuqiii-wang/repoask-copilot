package com.security.trading.fx;

import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class FxService {
    
    private final ConcurrentHashMap<String, FxTrade> trades = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Double> exchangeRates = new ConcurrentHashMap<>();
    
    public FxService() {
        // Initialize some default exchange rates
        exchangeRates.put("USD/EUR", 0.92);
        exchangeRates.put("USD/GBP", 0.79);
        exchangeRates.put("USD/JPY", 149.50);
        exchangeRates.put("USD/CNY", 7.15);
    }
    
    public FxTrade executeTrade(FxTrade trade) {
        // Generate trade ID if not provided
        if (trade.getTradeId() == null) {
            trade.setTradeId("FX-" + LocalDateTime.now().getYear() + "-" + String.format("%05d", trades.size() + 1));
        }
        
        // Set timestamp if not provided
        if (trade.getTimestamp() == null) {
            trade.setTimestamp(LocalDateTime.now());
        }
        
        // Get or generate exchange rate
        if (trade.getExchangeRate() == 0) {
            Double rate = exchangeRates.get(trade.getCurrencyPair());
            if (rate != null) {
                trade.setExchangeRate(rate);
            } else {
                // Generate a random rate for demonstration
                trade.setExchangeRate(1 + Math.random() * 10);
            }
        }
        
        // Simulate trade execution
        trade.setStatus("EXECUTED");
        trade.setFilledQuantity(trade.getQuantity());
        trade.setAveragePrice(trade.getPrice());
        
        // Store trade
        trades.put(trade.getTradeId(), trade);
        
        return trade;
    }
    
    public FxRate getExchangeRate(String currencyPair) {
        FxRate rate = new FxRate();
        rate.setCurrencyPair(currencyPair);
        
        Double midRate = exchangeRates.get(currencyPair);
        if (midRate == null) {
            midRate = 1 + Math.random() * 10;
        }
        
        // Generate bid/ask based on mid rate
        rate.setMid(midRate);
        rate.setBid(midRate * 0.999);
        rate.setAsk(midRate * 1.001);
        rate.setTimestamp(LocalDateTime.now());
        rate.setSource("SIMULATED");
        
        return rate;
    }
    
    public List<FxTrade> getTrades() {
        return new ArrayList<>(trades.values());
    }
    
    public FxTrade getTrade(String tradeId) {
        return trades.get(tradeId);
    }
}
