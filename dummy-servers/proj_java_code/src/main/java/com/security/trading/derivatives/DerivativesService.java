package com.security.trading.derivatives;

import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class DerivativesService {
    
    private final ConcurrentHashMap<String, OptionTrade> trades = new ConcurrentHashMap<>();
    
    public OptionTrade executeTrade(OptionTrade trade) {
        // Generate trade ID if not provided
        if (trade.getTradeId() == null) {
            trade.setTradeId("OPT-" + LocalDateTime.now().getYear() + "-" + String.format("%05d", trades.size() + 1));
        }
        
        // Set timestamp if not provided
        if (trade.getTimestamp() == null) {
            trade.setTimestamp(LocalDateTime.now());
        }
        
        // Calculate Greeks if not provided
        if (trade.getDelta() == 0) {
            calculateGreeks(trade);
        }
        
        // Simulate trade execution
        trade.setStatus("EXECUTED");
        trade.setFilledQuantity(trade.getQuantity());
        trade.setAveragePrice(trade.getPrice());
        
        // Store trade
        trades.put(trade.getTradeId(), trade);
        
        return trade;
    }
    
    public OptionPriceResult priceOption(OptionPriceRequest request) {
        OptionPriceResult result = new OptionPriceResult();
        
        // Simulate Black-Scholes pricing
        result.setOptionPrice(10 + Math.random() * 20);
        result.setDelta(0.3 + Math.random() * 0.4);
        result.setGamma(0.01 + Math.random() * 0.02);
        result.setTheta(-0.1 + Math.random() * 0.05);
        result.setVega(0.5 + Math.random() * 0.5);
        result.setRho(0.05 + Math.random() * 0.1);
        result.setImpliedVolatility(request.getImpliedVolatility());
        result.setTimeValue(5 + Math.random() * 10);
        result.setIntrinsicValue(2 + Math.random() * 8);
        
        return result;
    }
    
    private void calculateGreeks(OptionTrade trade) {
        // Simulate Greek calculations
        trade.setDelta(0.3 + Math.random() * 0.4);
        trade.setGamma(0.01 + Math.random() * 0.02);
        trade.setTheta(-0.1 + Math.random() * 0.05);
        trade.setVega(0.5 + Math.random() * 0.5);
        trade.setRho(0.05 + Math.random() * 0.1);
    }
    
    public List<OptionTrade> getTrades() {
        return new ArrayList<>(trades.values());
    }
    
    public OptionTrade getTrade(String tradeId) {
        return trades.get(tradeId);
    }
}
