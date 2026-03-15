package com.security.trading.fixedincome;

import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class FixedIncomeService {
    
    private final ConcurrentHashMap<String, BondTrade> trades = new ConcurrentHashMap<>();
    
    public BondTrade executeTrade(BondTrade trade) {
        // Generate trade ID if not provided
        if (trade.getTradeId() == null) {
            trade.setTradeId("FI-" + LocalDateTime.now().getYear() + "-" + String.format("%05d", trades.size() + 1));
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
    
    public BondCalculationResult calculateBondMetrics(BondCalculationRequest request) {
        BondCalculationResult result = new BondCalculationResult();
        result.setIsin(request.getIsin());
        
        // Simulate calculations
        result.setYieldToMaturity(3.5 + Math.random() * 2);
        result.setDuration(5.2 + Math.random() * 3);
        result.setConvexity(30 + Math.random() * 20);
        result.setCurrentYield(request.getCouponRate() / request.getMarketPrice() * 100);
        result.setCleanPrice(request.getMarketPrice());
        result.setDirtyPrice(request.getMarketPrice() + 0.5);
        
        return result;
    }
    
    public List<BondTrade> getTrades() {
        return new ArrayList<>(trades.values());
    }
    
    public BondTrade getTrade(String tradeId) {
        return trades.get(tradeId);
    }
}
