package com.security.trading.controller;

import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;

import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/settlement")
public class SettlementController {
    
    private final SettlementService settlementService;
    
    public SettlementController(SettlementService settlementService) {
        this.settlementService = settlementService;
    }
    
    @PostMapping("/create")
    public Settlement createSettlement(@RequestBody Settlement settlement) {
        return settlementService.createSettlement(settlement);
    }
    
    @PutMapping("/process/{settlementId}")
    public Settlement processSettlement(@PathVariable String settlementId) {
        return settlementService.processSettlement(settlementId);
    }
    
    @GetMapping("/settlements")
    public List<Settlement> getSettlements() {
        return settlementService.getSettlements();
    }
    
    @GetMapping("/settlements/{settlementId}")
    public Settlement getSettlement(@PathVariable String settlementId) {
        return settlementService.getSettlement(settlementId);
    }
    
    @GetMapping("/settlements/trade/{tradeId}")
    public List<Settlement> getSettlementsByTradeId(@PathVariable String tradeId) {
        return settlementService.getSettlementsByTradeId(tradeId);
    }
}
