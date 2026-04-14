package com.security.trading.service.impl;

import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;


import com.security.trading.service.EquityTradingService;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class EquityTradingServiceImpl implements EquityTradingService {

    private static final Logger logger = LogManager.getLogger(EquityTradingService.class);

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

        logger.info("Equity trade executed: tradeId={}, symbol={}, side={}, qty={}, price={}, status={}",
                trade.getTradeId(), trade.getSymbol(), trade.getSide(),
                trade.getFilledQuantity(), String.format("%.2f", trade.getAveragePrice()), trade.getStatus());
        
        return trade;
    }
    
    public List<EquityTrade> getTrades() {
        logger.debug("Retrieving all equity trades: count={}", trades.size());
        return new ArrayList<>(trades.values());
    }
    
    public EquityTrade getTrade(String tradeId) {
        EquityTrade trade = trades.get(tradeId);
        if (trade == null) {
            logger.warn("Equity trade not found: tradeId={}", tradeId);
        }
        return trade;
    }
}
