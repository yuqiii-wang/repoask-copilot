package com.security.trading.controller;

import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;

import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/derivatives")
public class DerivativesController {
    
    private final DerivativesService derivativesService;
    
    public DerivativesController(DerivativesService derivativesService) {
        this.derivativesService = derivativesService;
    }
    
    @PostMapping("/trade")
    public OptionTrade executeTrade(@RequestBody OptionTrade trade) {
        return derivativesService.executeTrade(trade);
    }
    
    @PostMapping("/price")
    public OptionPriceResult priceOption(@RequestBody OptionPriceRequest request) {
        return derivativesService.priceOption(request);
    }
    
    @GetMapping("/trades")
    public List<OptionTrade> getTrades() {
        return derivativesService.getTrades();
    }
    
    @GetMapping("/trades/{tradeId}")
    public OptionTrade getTrade(@PathVariable String tradeId) {
        return derivativesService.getTrade(tradeId);
    }
}
