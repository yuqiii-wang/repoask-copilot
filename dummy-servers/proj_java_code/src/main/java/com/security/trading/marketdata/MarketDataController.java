package com.security.trading.marketdata;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/marketdata")
public class MarketDataController {
    
    private final MarketDataService marketDataService;
    
    public MarketDataController(MarketDataService marketDataService) {
        this.marketDataService = marketDataService;
    }
    
    @GetMapping("/quote/{symbol}")
    public MarketData getQuote(@PathVariable String symbol) {
        return marketDataService.getMarketData(symbol);
    }
    
    @GetMapping("/quotes")
    public MarketData[] getQuotes(@RequestParam String symbols) {
        String[] symbolArray = symbols.split(",");
        return marketDataService.getMarketDataBatch(symbolArray);
    }
}
