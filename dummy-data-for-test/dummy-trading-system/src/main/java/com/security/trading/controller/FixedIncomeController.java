package com.security.trading.controller;

import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;

import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/fixedincome")
public class FixedIncomeController {
    
    private final FixedIncomeService fixedIncomeService;
    
    public FixedIncomeController(FixedIncomeService fixedIncomeService) {
        this.fixedIncomeService = fixedIncomeService;
    }
    
    @PostMapping("/trade")
    public BondTrade executeTrade(@RequestBody BondTrade trade) {
        return fixedIncomeService.executeTrade(trade);
    }
    
    @PostMapping("/calculate")
    public BondCalculationResult calculateBondMetrics(@RequestBody BondCalculationRequest request) {
        return fixedIncomeService.calculateBondMetrics(request);
    }
    
    @GetMapping("/trades")
    public List<BondTrade> getTrades() {
        return fixedIncomeService.getTrades();
    }
    
    @GetMapping("/trades/{tradeId}")
    public BondTrade getTrade(@PathVariable String tradeId) {
        return fixedIncomeService.getTrade(tradeId);
    }
}
