package com.security.trading.marketdata;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class MarketDataService {
    
    private static final Logger logger = LogManager.getLogger(MarketDataService.class);
    private final ConcurrentHashMap<String, MarketData> marketDataCache = new ConcurrentHashMap<>();
    
    public void startMarketDataSync() {
        logger.info("Pre-market data sync started: syncTime={} EDT", LocalDateTime.now());
        logger.info("Data source connections: Bloomberg=CONNECTED, Reuters=CONNECTED, ICE=CONNECTED, CME=CONNECTED, CBOE=CONNECTED");

        // Simulate loading 12456 symbols
        logger.debug("Pre-market load: totalSymbols={}, loaded={}, missing={} (exotic_EM), latency_ms={}",
            12456, 12450, 6, 13800);

        // Simulate occasional Reuters startup failure with retry/restore
        if (Math.random() < 0.15) {
            logger.error("Market data sync FAILED on startup: source=REUTERS, exception=ConnectionTimeoutException: timeout after 30000ms, attempt=1/3");
            logger.warn("Retrying Reuters connection with exponential backoff: nextRetry={}", LocalDateTime.now().plusSeconds(30));
            logger.info("Reuters connection RESTORED: recoveryRate=94.2%, failedSymbols=[EXOTIC-EM-3], dataLag=620ms");
        }

        // VIX and data quality pre-open
        logger.info("VIX pre-market: VIX=16.82, change=-0.43 (-2.49%), term_structure=[VIX1M=16.8, VIX3M=17.4, VIX6M=18.1] (contango)");
        logger.info("Data quality pre-open: dataLag_max=380ms, dataLag_avg=95ms, gaps=0, stale_symbols=6 (exotic_EM), qualityScore=99.95%");
    
    public MarketData getMarketData(String symbol) {
        // Check if data is in cache
        MarketData data = marketDataCache.get(symbol);
        if (data == null || data.getTimestamp().plusSeconds(30).isBefore(LocalDateTime.now())) {
            // Generate new market data
            data = generateMarketData(symbol);
            marketDataCache.put(symbol, data);
            
            // Log the market data update with spread calculations
            double spread = data.getAsk() - data.getBid();
            double spreadBps = (spread / data.getLastPrice()) * 10000.0;
            logger.debug("Opening market snapshot: symbol={}, bid={}, ask={}, spread={} ({}bps), volume={}, VWAP={}",
                symbol, String.format("%.2f", data.getBid()), String.format("%.2f", data.getAsk()),
                String.format("%.2f", spread), String.format("%.4f", spreadBps), 
                data.getVolume(), String.format("%.2f", data.getLastPrice()));
        }
        return data;
    }
    
    public void logIntraDayDataUpdate(String symbol, double newPrice, double previousPrice, int volumeIncrement) {
        double change = newPrice - previousPrice;
        double changePct = (change / previousPrice) * 100.0;
        
        logger.debug("VWAP quote update: price_prev={}, price_now={}, change={}, change%={}%, volume_incremental={}",
            String.format("%.2f", previousPrice), String.format("%.2f", newPrice),
            String.format("%.2f", change), String.format("%.4f", changePct),
            volumeIncrement);
    }
    
    public void logVolumeProfile(String symbol, double open, double high, double low, double close, int volume) {
        double priceRange = high - low;
        double rangeAmount = (priceRange / open) * 100.0;
        double vwap = close; // Simplified VWAP calculation
        double twap = close; // Simplified TWAP
        
        logger.info("Volume profile: {}={{open={}, high={}, low={}, current={}, volume={}, price_range={} ({}%)}}",
            symbol, String.format("%.2f", open), String.format("%.2f", high),
            String.format("%.2f", low), String.format("%.2f", close),
            volume, String.format("%.2f", priceRange), String.format("%.2f", rangeAmount));
        
        logger.debug("Volume-weighted metrics: VWAP={} (calculated from {} vol), TWAP={} (time-weighted average), std_dev={}",
            String.format("%.2f", vwap), volume, String.format("%.2f", twap), "0.087");
    }
    
    public void logBondMarketSnapshot(double yield10y, double yieldChange10y, double yield2y, double yieldChange2y) {
        logger.info("Bond market snapshot: UST_10Y={{yield={}, ytd_change={}bps}}, UST_2Y={{yield={}, ytd_change={}bps}}",
            String.format("%.2f", yield10y), String.format("%.0f", yieldChange10y),
            String.format("%.2f", yield2y), String.format("%.0f", yieldChange2y));
        
        // Bond pricing formula: price = 100 / (1 + yield/2)^(years*2)
        double price10Y = 100.0 / Math.pow(1 + yield10y / 2, 10 * 2);
        logger.debug("Yield curve formula: price = 100 / (1 + yield/2)^(years*2) = 100 / (1 + {}/2)^(10*2) = {} (approx for UST 10Y)",
            String.format("%.4f", yield10y), String.format("%.2f", price10Y));
    }
    
    public void logFXMarketSnapshot(String pair, double rate, double change, double changePct, double volume) {
        logger.info("FX market: {}={{rate={}, change={}, change%={}%, volume={}}}",
            pair, String.format("%.4f", rate), String.format("%.4f", change),
            String.format("%.3f", changePct), String.format("%.2fT USD", volume / 1e12));
        
        // FX conversion example
        double amountEUR = 10.5e6;
        double convertedUSD = amountEUR * rate;
        logger.debug("FX conversion: amount_EUR={}M, converted_to_USD = {}M * {} = {}M",
            String.format("%.1f", amountEUR / 1e6), String.format("%.1f", amountEUR / 1e6),
            String.format("%.4f", rate), String.format("%.2f", convertedUSD / 1e6));
    }
    
    public void logEquityOptionsSnapshot(String symbol, double bidCall, double askCall, double ivCall, double deltaCall) {
        logger.info("Equity options market: {}_450_CALL={{bid={}, ask={}, iv={}%, delta={}}}, {}_450_PUT={{bid={}, ask={}, iv={}%, delta={}}}",
            symbol, String.format("%.2f", bidCall), String.format("%.2f", askCall),
            String.format("%.1f", ivCall), String.format("%.3f", deltaCall),
            symbol, String.format("%.2f", bidCall - 2.3), String.format("%.2f", askCall - 2.3),
            String.format("%.1f", ivCall - 0.3), String.format("%.3f", -0.371));
        
        logger.debug("Greeks monitoring: SPY option delta = {} (0.629 exposure per 1% market move), gamma = {}, theta = {}/day",
            String.format("%.3f", deltaCall), "0.00823", "-0.031");
    }
    
    public void logLiquidityAlert(String symbol, double bid, double ask, double spread, double volume) {
        double spreadBps = (spread / ((bid + ask) / 2)) * 10000.0;
        logger.warn("Liquidity alert: symbol={}, bid={}, ask={}, spread={} ({}bps), unusual for this symbol (avg spread=0.25pts)",
            symbol, String.format("%.2f", bid), String.format("%.2f", ask),
            String.format("%.2f", spread), String.format("%.1f", spreadBps));
        
        double impliedBidAskCost = 1000000 * (spreadBps / 10000);
        logger.info("Liquidity context: volume_{}={}, implied_bid_ask_cost = notional * spread_bps / 10000 = 1000000 * {} / 10000 = {}",
            symbol, 45000, String.format("%.4f", spreadBps / 10000), String.format("%.0f", impliedBidAskCost));
    }
    
    public void logEODSnapshot(String symbol, double closePrice, long volume, double change, double changePct) {
        logger.info("Market close snapshot: {}={{close={}, volume={}M, change={}, change%={}%}}",
            symbol, String.format("%.2f", closePrice), String.format("%.1f", volume / 1e6),
            String.format("%.2f", change), String.format("%.3f", changePct));
        
        // Daily return calculation
        double openPrice = closePrice - change;
        double dailyReturn = (closePrice - openPrice) / openPrice;
        logger.debug("Daily return calculation: {}_return = (close - open) / open = ({} - {}) / {} = {}%",
            symbol, String.format("%.2f", closePrice), String.format("%.2f", openPrice),
            String.format("%.2f", openPrice), String.format("%.4f", dailyReturn * 100));
    }
    
    public MarketData[] getMarketDataBatch(String[] symbols) {
        MarketData[] results = new MarketData[symbols.length];
        for (int i = 0; i < symbols.length; i++) {
            results[i] = getMarketData(symbols[i]);
        }
        return results;
    }

    public void logMarketDataPartialFailure(String source, String[] failedSymbols) {
        logger.error("Market data PARTIAL FAILURE: source={}, failedSymbols={}, partialRecovery=false, dataLag=890ms for affected symbols",
            source, java.util.Arrays.toString(failedSymbols));
        logger.warn("Using Reuters as fallback for {}-failed symbols: {}, latency_delta=+120ms vs {}",
            source, java.util.Arrays.toString(failedSymbols), source);
    }
    
    private MarketData generateMarketData(String symbol) {
        MarketData data = new MarketData();
        data.setSymbol(symbol);
        data.setTimestamp(LocalDateTime.now());
        
        // Generate random market data
        double basePrice = 100 + Math.random() * 900;
        data.setLastPrice(roundToTwoDecimals(basePrice));
        data.setBid(roundToTwoDecimals(basePrice - 0.01));
        data.setAsk(roundToTwoDecimals(basePrice + 0.01));
        data.setVolume((int)(1000 + Math.random() * 9000));
        data.setExchange("NYSE");
        data.setOpenPrice(roundToTwoDecimals(basePrice - 1 + Math.random() * 2));
        data.setHighPrice(roundToTwoDecimals(Math.max(data.getOpenPrice(), data.getLastPrice()) + Math.random()));
        data.setLowPrice(roundToTwoDecimals(Math.min(data.getOpenPrice(), data.getLastPrice()) - Math.random()));
        data.setPreviousClose(roundToTwoDecimals(basePrice - 0.5 + Math.random()));
        
        return data;
    }
    
    private double roundToTwoDecimals(double value) {
        return Math.round(value * 100) / 100.0;
    }
}
