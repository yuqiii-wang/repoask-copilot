package com.security.trading.equities;

import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class EquityTradingService {
    
    private final ConcurrentHashMap<String, EquityTrade> trades = new ConcurrentHashMap<>();
    
    public EquityTrade executeTrade(EquityTrade trade) {
        // Generate trade ID if not provided
        if (trade.getTradeId() == null) {
            trade.setTradeId("EQ-" + LocalDateTime.now().getYear() + "-" + String.format("%05d", trades.size() + 1));
        }
        
        // Set timestamp if not provided
        if (trade.getTimestamp() == null) {
            trade.setTimestamp(LocalDateTime.now());
        }
        
        // Simulate trade execution
        trade.setStatus("EXECUTED");
        trade.setFilledQuantity(trade.getQuantity());
        trade.setAveragePrice(trade.getPrice());
        
        // Store trade
        trades.put(trade.getTradeId(), trade);
        
        return trade;
    }
    
    public List<EquityTrade> getTrades() {
        return new ArrayList<>(trades.values());
    }
    
    public EquityTrade getTrade(String tradeId) {
        return trades.get(tradeId);
    }
}
