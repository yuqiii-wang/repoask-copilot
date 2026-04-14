package com.security.trading.controller;

import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;

import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/algo")
public class AlgoController {
    
    private final AlgoService algoService;
    
    public AlgoController(AlgoService algoService) {
        this.algoService = algoService;
    }
    
    @PostMapping("/strategy")
    public AlgoStrategy createStrategy(@RequestBody AlgoStrategy strategy) {
        return algoService.createStrategy(strategy);
    }
    
    @PutMapping("/strategy/{strategyId}/activate")
    public AlgoStrategy activateStrategy(@PathVariable String strategyId) {
        return algoService.activateStrategy(strategyId);
    }
    
    @PutMapping("/strategy/{strategyId}/deactivate")
    public AlgoStrategy deactivateStrategy(@PathVariable String strategyId) {
        return algoService.deactivateStrategy(strategyId);
    }
    
    @GetMapping("/strategies")
    public List<AlgoStrategy> getStrategies() {
        return algoService.getStrategies();
    }
    
    @GetMapping("/strategies/{strategyId}")
    public AlgoStrategy getStrategy(@PathVariable String strategyId) {
        return algoService.getStrategy(strategyId);
    }
    
    @PostMapping("/backtest")
    public BacktestResult backtestStrategy(@RequestBody BacktestRequest request) {
        return algoService.backtestStrategy(request);
    }
}
