package com.security.trading.fx;

import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/fx")
public class FxController {
    
    private final FxService fxService;
    
    public FxController(FxService fxService) {
        this.fxService = fxService;
    }
    
    @PostMapping("/trade")
    public FxTrade executeTrade(@RequestBody FxTrade trade) {
        return fxService.executeTrade(trade);
    }
    
    @GetMapping("/rates/{currencyPair}")
    public FxRate getExchangeRate(@PathVariable String currencyPair) {
        return fxService.getExchangeRate(currencyPair);
    }
    
    @GetMapping("/trades")
    public List<FxTrade> getTrades() {
        return fxService.getTrades();
    }
    
    @GetMapping("/trades/{tradeId}")
    public FxTrade getTrade(@PathVariable String tradeId) {
        return fxService.getTrade(tradeId);
    }
}
