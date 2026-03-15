package com.security.trading.algo;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class AlgoService {
    
    private final ConcurrentHashMap<String, AlgoStrategy> strategies = new ConcurrentHashMap<>();
    
    public AlgoStrategy createStrategy(AlgoStrategy strategy) {
        // Generate strategy ID if not provided
        if (strategy.getStrategyId() == null) {
            strategy.setStrategyId("ALGO-" + String.format("%05d", strategies.size() + 1));
        }
        
        // Set default status if not provided
        if (strategy.getStatus() == null) {
            strategy.setStatus("INACTIVE");
        }
        
        // Store strategy
        strategies.put(strategy.getStrategyId(), strategy);
        
        return strategy;
    }
    
    public AlgoStrategy activateStrategy(String strategyId) {
        AlgoStrategy strategy = strategies.get(strategyId);
        if (strategy != null) {
            strategy.setStatus("ACTIVE");
        }
        return strategy;
    }
    
    public AlgoStrategy deactivateStrategy(String strategyId) {
        AlgoStrategy strategy = strategies.get(strategyId);
        if (strategy != null) {
            strategy.setStatus("INACTIVE");
        }
        return strategy;
    }
    
    public List<AlgoStrategy> getStrategies() {
        return new ArrayList<>(strategies.values());
    }
    
    public AlgoStrategy getStrategy(String strategyId) {
        return strategies.get(strategyId);
    }
    
    public BacktestResult backtestStrategy(BacktestRequest request) {
        BacktestResult result = new BacktestResult();
        result.setBacktestId("BT-" + String.format("%05d", 1));
        result.setStrategyId(request.getStrategyId());
        
        // Simulate backtest results
        result.setTotalReturn(10 + Math.random() * 20);
        result.setSharpeRatio(1 + Math.random() * 2);
        result.setMaxDrawdown(5 + Math.random() * 10);
        result.setTotalTrades(100 + (int)(Math.random() * 400));
        result.setWinRate(0.5 + Math.random() * 0.3);
        result.setAverageWin(2 + Math.random() * 3);
        result.setAverageLoss(1 + Math.random() * 2);
        result.setFinalCapital(request.getInitialCapital() * (1 + result.getTotalReturn() / 100));
        
        return result;
    }
}
