package com.security.trading.service.impl;

import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;


import com.security.trading.service.FxService;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class FxServiceImpl implements FxService {

    private static final Logger logger = LogManager.getLogger(FxService.class);

    // Stale threshold: rates older than 1 hour trigger a warning
    private static final long STALE_RATE_THRESHOLD_SECONDS = 3600;

    private final ConcurrentHashMap<String, FxTrade> trades = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Double> exchangeRates = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, LocalDateTime> rateTimestamps = new ConcurrentHashMap<>();

    public FxServiceImpl() {
        // Initialize some default exchange rates
        LocalDateTime now = LocalDateTime.now();
        exchangeRates.put("EURUSD", 1.0834);
        exchangeRates.put("GBPUSD", 1.2613);
        exchangeRates.put("USDJPY", 151.34);
        exchangeRates.put("USDCNY", 7.15);
        rateTimestamps.put("EURUSD", now);
        rateTimestamps.put("GBPUSD", now);
        rateTimestamps.put("USDJPY", now);
        rateTimestamps.put("USDCNY", now);
        logger.info("FX rate table initialized: EURUSD=1.0834, GBPUSD=1.2613, USDJPY=151.34, USDCNY=7.15");
    }

    public FxTrade executeTrade(FxTrade trade) {
        // Generate trade ID if not provided
        if (trade.getTradeId() == null) {
            trade.setTradeId("FX-" + LocalDateTime.now().getYear() + "-" + String.format("%05d", trades.size() + 1));
        }

        // Set timestamp if not provided
        if (trade.getTimestamp() == null) {
            trade.setTimestamp(LocalDateTime.now());
        }

        String pair = trade.getCurrencyPair();

        // Get or generate exchange rate
        if (trade.getExchangeRate() == 0) {
            Double rate = exchangeRates.get(pair);
            if (rate != null) {
                trade.setExchangeRate(rate);
                checkStaleRate(pair);
            } else {
                logger.error("FX conversion failed: currencyPair={}, exception=UnknownCurrencyException", pair);
                trade.setStatus("REJECTED");
                trade.setFilledQuantity(0);
                return trade;
            }
        }

        double rate = trade.getExchangeRate();
        double notionalUsd = trade.getQuantity() * rate;
        // Compute spread (bid/ask ±0.5bps)
        double bid = rate * 0.99995;
        double ask = rate * 1.00005;
        double spread = ask - bid;
        double spreadBps = (spread / rate) * 10_000.0;
        double feeUsd = notionalUsd * (spreadBps / 10_000.0);
        LocalDateTime settlementDate = LocalDateTime.now().plusDays(2);

        logger.info("FX order: buy={} {}, sell=USD, rate={}, notional_usd={}, settlement={} T+2",
                String.format("%.0f", (double) trade.getQuantity()),
                pair != null ? pair.replace("USD", "") : "?",
                String.format("%.4f", rate),
                String.format("%.2f", notionalUsd),
                settlementDate.toLocalDate());

        logger.debug("FX spread captured: bid={}, ask={}, mid={}, spread={} ({}bps), fee={} USD",
                String.format("%.4f", bid),
                String.format("%.4f", ask),
                String.format("%.4f", rate),
                String.format("%.4f", spread),
                String.format("%.2f", spreadBps),
                String.format("%.2f", feeUsd));

        // Simulate trade execution
        trade.setStatus("EXECUTED");
        trade.setFilledQuantity(trade.getQuantity());
        trade.setAveragePrice(rate);
        trades.put(trade.getTradeId(), trade);

        logger.info("[{}] FX trade EXECUTED: pair={}, qty={}, rate={}, notional_usd={}, status=EXECUTED",
                trade.getTradeId(), pair,
                String.format("%.0f", (double) trade.getQuantity()),
                String.format("%.4f", rate),
                String.format("%.2f", notionalUsd));

        return trade;
    }

    public FxRate getExchangeRate(String currencyPair) {
        FxRate rate = new FxRate();
        rate.setCurrencyPair(currencyPair);

        Double midRate = exchangeRates.get(currencyPair);
        if (midRate == null) {
            logger.error("FX conversion failed: fromCurrency={}, toCurrency=USD, exception=UnknownCurrencyException",
                    currencyPair);
            midRate = 1 + Math.random() * 10;
        } else {
            checkStaleRate(currencyPair);
        }

        // Generate bid/ask based on mid rate
        rate.setMid(midRate);
        rate.setBid(midRate * 0.99995);
        rate.setAsk(midRate * 1.00005);
        rate.setTimestamp(LocalDateTime.now());
        rate.setSource("SIMULATED");

        logger.debug("FX rate lookup: pair={}, bid={}, ask={}, mid={}, source=SIMULATED",
                currencyPair,
                String.format("%.4f", rate.getBid()),
                String.format("%.4f", rate.getAsk()),
                String.format("%.4f", midRate));

        return rate;
    }

    private void checkStaleRate(String currencyPair) {
        LocalDateTime ts = rateTimestamps.get(currencyPair);
        if (ts != null) {
            long ageSeconds = Duration.between(ts, LocalDateTime.now()).getSeconds();
            if (ageSeconds > STALE_RATE_THRESHOLD_SECONDS) {
                logger.warn("FX rate stale: currency_pair={}, lastUpdate={}, age={} seconds ({} hours), attempting fallback rate",
                        currencyPair, ts,
                        ageSeconds,
                        String.format("%.1f", ageSeconds / 3600.0));
            }
        }
    }

    public List<FxTrade> getTrades() {
        return new ArrayList<>(trades.values());
    }
    
    public FxTrade getTrade(String tradeId) {
        return trades.get(tradeId);
    }
}
