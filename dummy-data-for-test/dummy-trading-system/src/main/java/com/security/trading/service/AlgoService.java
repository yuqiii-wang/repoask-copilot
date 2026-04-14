package com.security.trading.service;

import com.security.trading.model.dto.BacktestRequest;
import com.security.trading.model.dto.BacktestResult;
import com.security.trading.model.entity.AlgoStrategy;

import java.util.List;

public interface AlgoService {
    AlgoStrategy createStrategy(AlgoStrategy strategy);
    AlgoStrategy activateStrategy(String strategyId);
    AlgoStrategy deactivateStrategy(String strategyId);
    List<AlgoStrategy> getStrategies();
    AlgoStrategy getStrategy(String strategyId);
    BacktestResult backtestStrategy(BacktestRequest request);
}
