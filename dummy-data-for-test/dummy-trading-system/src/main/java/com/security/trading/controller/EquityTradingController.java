package com.security.trading.controller;

import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;

import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping("/api/equities")
public class EquityTradingController {
    
    private final EquityTradingService equityTradingService;
    
    public EquityTradingController(EquityTradingService equityTradingService) {
        this.equityTradingService = equityTradingService;
    }
    
    @PostMapping("/trade")
    public EquityTrade executeTrade(@RequestBody EquityTrade trade) {
        return equityTradingService.executeTrade(trade);
    }
    
    @GetMapping("/trades")
    public List<EquityTrade> getTrades() {
        return equityTradingService.getTrades();
    }
    
    @GetMapping("/trades/{tradeId}")
    public EquityTrade getTrade(@PathVariable String tradeId) {
        return equityTradingService.getTrade(tradeId);
    }
}
