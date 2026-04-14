package com.security.trading.service.impl;

import com.security.trading.chaos.FaultInjectionService;
import com.security.trading.client.SettlementGatewayFeignClient;
import com.security.trading.client.dto.ExternalSettlementConfirmResponse;
import com.security.trading.client.dto.ExternalSettlementRequest;
import com.security.trading.exception.DownstreamServerException;
import com.security.trading.exception.DownstreamTimeoutException;
import com.security.trading.exception.MissingArgumentException;
import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;


import com.security.trading.service.SettlementService;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.retry.annotation.Backoff;
import org.springframework.retry.annotation.Recover;
import org.springframework.retry.annotation.Retryable;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class SettlementServiceImpl implements SettlementService {
    
    private static final Logger logger = LogManager.getLogger(SettlementService.class);
    
    private final ConcurrentHashMap<String, Settlement> settlements = new ConcurrentHashMap<>();
    private final SettlementGatewayFeignClient settlementGatewayClient;
    private final FaultInjectionService faultInjectionService;

    public SettlementServiceImpl(SettlementGatewayFeignClient settlementGatewayClient,
                                 FaultInjectionService faultInjectionService) {
        this.settlementGatewayClient = settlementGatewayClient;
        this.faultInjectionService = faultInjectionService;
    }

    // ── Recover methods (called only if all retries are exhausted) ─────────────

    @Recover
    public Settlement recoverCreateSettlement(DownstreamTimeoutException ex, Settlement settlement) {
        logger.error("[RETRY-EXHAUSTED] createSettlement timed out after all attempts: settlementId={}, error={}",
                settlement.getSettlementId(), ex.getMessage());
        settlement.setStatus("FAILED");
        settlement.setFailureReason("Downstream timeout — retries exhausted");
        return settlement;
    }

    @Recover
    public Settlement recoverCreateSettlement(MissingArgumentException ex, Settlement settlement) {
        logger.error("[RETRY-EXHAUSTED] createSettlement missing arg after all attempts: error={}", ex.getMessage());
        settlement.setStatus("FAILED");
        settlement.setFailureReason("Missing argument — retries exhausted");
        return settlement;
    }

    @Recover
    public Settlement recoverCreateSettlement(DownstreamServerException ex, Settlement settlement) {
        logger.error("[RETRY-EXHAUSTED] createSettlement downstream 5xx after all attempts: error={}", ex.getMessage());
        settlement.setStatus("FAILED");
        settlement.setFailureReason("Downstream server error — retries exhausted");
        return settlement;
    }

    @Recover
    public Settlement recoverProcessSettlement(DownstreamTimeoutException ex, String settlementId) {
        logger.error("[RETRY-EXHAUSTED] processSettlement timed out: settlementId={}, error={}", settlementId, ex.getMessage());
        Settlement s = settlements.get(settlementId);
        if (s != null) { s.setStatus("FAILED"); s.setFailureReason("Downstream timeout — retries exhausted"); }
        return s;
    }

    @Recover
    public Settlement recoverProcessSettlement(MissingArgumentException ex, String settlementId) {
        logger.error("[RETRY-EXHAUSTED] processSettlement missing arg: settlementId={}, error={}", settlementId, ex.getMessage());
        Settlement s = settlements.get(settlementId);
        if (s != null) { s.setStatus("FAILED"); s.setFailureReason("Missing argument — retries exhausted"); }
        return s;
    }

    @Recover
    public Settlement recoverProcessSettlement(DownstreamServerException ex, String settlementId) {
        logger.error("[RETRY-EXHAUSTED] processSettlement downstream 5xx: settlementId={}, error={}", settlementId, ex.getMessage());
        Settlement s = settlements.get(settlementId);
        if (s != null) { s.setStatus("FAILED"); s.setFailureReason("Downstream server error — retries exhausted"); }
        return s;
    }

    // ── Service methods ─────────────────────────────────────────────────────────

    @Retryable(
        retryFor = {DownstreamTimeoutException.class, MissingArgumentException.class, DownstreamServerException.class},
        maxAttempts = 2,
        backoff = @Backoff(delay = 200)
    )
    public Settlement createSettlement(Settlement settlement) {
        // ── Chaos: fault injection (disabled outside chaos profile) ──────────
        faultInjectionService.checkFault("settlement.create");

        // ── Guard: required fields ───────────────────────────────────────────
        if (settlement == null) {
            logger.error("[FAULT] createSettlement called with null settlement object");
            throw new MissingArgumentException("settlement");
        }
        if (settlement.getTradeId() == null || settlement.getTradeId().isBlank()) {
            logger.error("[FAULT] createSettlement missing tradeId");
            throw new MissingArgumentException("tradeId");
        }
        // Generate settlement ID if not provided
        if (settlement.getSettlementId() == null) {
            settlement.setSettlementId("SETTLE-" + LocalDateTime.now().getYear() + "-" + String.format("%05d", settlements.size() + 1));
        }
        
        // Set timestamps
        LocalDateTime now = LocalDateTime.now();
        settlement.setCreatedAt(now);
        settlement.setUpdatedAt(now);
        
        // Set initial status
        if (settlement.getStatus() == null) {
            settlement.setStatus("PENDING");
        }
        
        // Store settlement
        settlements.put(settlement.getSettlementId(), settlement);
        
        return settlement;
    }
    
    @Retryable(
        retryFor = {DownstreamTimeoutException.class, MissingArgumentException.class, DownstreamServerException.class},
        maxAttempts = 2,
        backoff = @Backoff(delay = 200)
    )
    public Settlement processSettlement(String settlementId) {
        // ── Chaos: fault injection ───────────────────────────────────────────
        faultInjectionService.checkFault("settlement.process");

        // ── Guard: required fields ───────────────────────────────────────────
        if (settlementId == null || settlementId.isBlank()) {
            logger.error("[FAULT] processSettlement called with null/blank settlementId");
            throw new MissingArgumentException("settlementId");
        }

        Settlement settlement = settlements.get(settlementId);
        if (settlement != null) {
            try {
                logger.debug("Processing settlement: settlementId={}, tradeId={}, amount={}", 
                    settlementId, settlement.getTradeId(), settlement.getSettlementAmount());
                
                // Validate security
                String isin = settlement.getIsin();
                if (isin == null || !isin.matches("^[A-Z]{2}[A-Z0-9]{9}[0-9]$")) {
                    logger.error("Settlement FAILED for settlementId={}: settlement instruction failed for ISIN validation", settlementId);
                    settlement.setStatus("FAILED");
                    settlement.setFailureReason("Invalid ISIN");
                    return settlement;
                }
                
                // Check cash adequacy: requiredCash = settlementAmount + settlementFee
                double requiredCash = settlement.getSettlementAmount() * 1.0001; // 0.01% fee
                double availableCash = 500000.0; // Simulated available cash
                
                if (requiredCash > availableCash) {
                    double shortfall = requiredCash - availableCash;
                    logger.error("Settlement instruction FAILED: settlementId={}, reason=INSUFFICIENT_CASH, " +
                        "requiredCash={}, availableCash={}, shortfall={}",
                        settlementId, String.format("%.2f", requiredCash),
                        String.format("%.2f", availableCash), String.format("%.2f", shortfall));
                    settlement.setStatus("FAILED");
                    settlement.setFailureReason("Insufficient funds");
                    // Trigger cash buffer reconciliation when utilization is high
                    double bufferUtilization = requiredCash / (availableCash + requiredCash) * 100.0;
                    logger.info("Invoking cash buffer reconciliation: bufferUtilization={}%, triggeringAuto-reconciliation",
                        String.format("%.1f", bufferUtilization));
                    return settlement;
                }
                
                // Calculate settlement metrics
                double settlementFee = settlement.getSettlementAmount() * 0.0001; // 0.01% fee
                logger.info("Settlement fee calculation: settlementFee = settlementAmount({}) * settlementFeeRate(0.01%) = {} * 0.0001 = {}",
                    String.format("%.2f", settlement.getSettlementAmount()),
                    String.format("%.2f", settlement.getSettlementAmount()),
                    String.format("%.2f", settlementFee));
                
                // Process settlement (90% success rate)
                if (Math.random() > 0.1) {
                    // Submit to external clearing gateway
                    ExternalSettlementRequest gatewayRequest = buildGatewayRequest(settlement);
                    ExternalSettlementConfirmResponse gatewayResponse;
                    try {
                        logger.info("Submitting settlement to clearing gateway: settlementId={}, method={}",
                                settlementId, settlement.getSettlementMethod());
                        gatewayResponse = settlementGatewayClient.confirmSettlement(gatewayRequest);
                        logger.info("Clearing gateway response: settlementId={}, externalRef={}, gatewayStatus={}, clearingHouse={}",
                                settlementId, gatewayResponse.getExternalRef(),
                                gatewayResponse.getStatus(), gatewayResponse.getClearingHouse());
                    } catch (Exception e) {
                        logger.warn("Clearing gateway unavailable for settlementId={}, using mock confirmation: {}",
                                settlementId, e.getMessage());
                        gatewayResponse = buildMockConfirmation(settlement);
                    }

                    if ("REJECTED".equals(gatewayResponse.getStatus())) {
                        settlement.setStatus("FAILED");
                        settlement.setFailureReason("Clearing gateway rejected: " + gatewayResponse.getRejectionReason());
                        logger.error("Settlement rejected by clearing gateway: settlementId={}, externalRef={}, reason={}",
                                settlementId, gatewayResponse.getExternalRef(), gatewayResponse.getRejectionReason());
                    } else {
                        settlement.setStatus("PROCESSED");
                        logger.info("Settlement processed successfully: settlementId={}, externalRef={}, amount={}, finalStatus=PROCESSED",
                                settlementId, gatewayResponse.getExternalRef(),
                                String.format("%.2f", settlement.getSettlementAmount()));
                    }
                } else {
                    settlement.setStatus("FAILED");
                    settlement.setFailureReason("Operational error");
                    logger.warn("Settlement processing failed: settlementId={}, reason={}", 
                        settlementId, settlement.getFailureReason());
                }
            } catch (Exception e) {
                logger.error("Settlement processing exception: settlementId={}, exception={}", 
                    settlementId, e.getMessage(), e);
                settlement.setStatus("FAILED");
                settlement.setFailureReason("Processing error");
            }
            settlement.setUpdatedAt(LocalDateTime.now());
        } else {
            logger.error("Settlement not found: settlementId={}", settlementId);
        }
        return settlement;
    }
    
    /**
     * Batch settlement processing with comprehensive logging
     */
    public void processBatchSettlement(LocalDateTime settlementDate) {
        logger.info("Settlement batch initiated: batchId=SETT-BATCH-{}-001, settlementDate={}", 
            settlementDate.toString().replace("-", ""), settlementDate);
        
        int totalTrades = settlements.size();
        double totalValue = settlements.values().stream()
            .mapToDouble(Settlement::getSettlementAmount)
            .sum();
        
        logger.info("Settlement batch initiated: batchId=SETT-BATCH-{}-001, totalTrades={}, totalValue={}", 
            settlementDate.toString().replace("-", ""), totalTrades, String.format("%.2f", totalValue));
        
        // Validate all settlements
        int validCount = 0;
        int invalidCount = 0;
        List<String> rejectedIds = new ArrayList<>();
        
        for (Settlement s : settlements.values()) {
            if (isValidSettlement(s)) {
                validCount++;
            } else {
                invalidCount++;
                rejectedIds.add(s.getSettlementId());
            }
        }
        
        logger.info("Validating trade instructions: total={}, passed={}, failed={}, rejectionRate={}%",
            totalTrades, validCount, invalidCount, 
            String.format("%.2f", (invalidCount * 100.0 / totalTrades)));
        
        if (!rejectedIds.isEmpty()) {
            logger.warn("Failed settlement instructions: tradeIds={}, causes=[INVALID_COUNTERPARTY, MISSING_SETTLEMENT_ACCT]",
                rejectedIds);
        }
        
        // Cash settlement processing with FX conversion
        double cashUSD = 0, cashEUR = 0, cashGBP = 0;
        for (Settlement s : settlements.values()) {
            if (isValidSettlement(s)) {
                double baseAmount = s.getSettlementAmount();
                // Simulate FX rates
                cashUSD += baseAmount * 1.0;     // USD base
                cashEUR += baseAmount * 0.71;   // EUR conversion (approx 1 EUR = 1.4 USD)
                cashGBP += baseAmount * 0.59;   // GBP conversion (approx 1 GBP = 1.7 USD)
            }
        }
        
        logger.info("Cash settlement processing: currencyCash=[{{currency=USD, amount={}}}, {{currency=EUR, amount={}}}, {{currency=GBP, amount={}}}]",
            String.format("%.2f", cashUSD), String.format("%.2f", cashEUR), String.format("%.2f", cashGBP));
        
        logger.debug("Cash calculation formulas: cashUSD = sum(notional * FXRate) for USD settlements = {}, " +
            "cashEUR = sum(...) = {}, cashGBP = sum(...) = {}",
            String.format("%.2f", cashUSD), String.format("%.2f", cashEUR), String.format("%.2f", cashGBP));
        
        // Settlement fee calculation
        double totalFee = totalValue * 0.0001; // 0.01% fee
        logger.info("Settlement fee calculation: settlementFee = totalValue({}) * settlementFeeRate(0.01%) = {} * 0.0001 = {}",
            String.format("%.2f", totalValue), String.format("%.2f", totalValue), String.format("%.2f", totalFee));
    }
    
    private ExternalSettlementRequest buildGatewayRequest(Settlement settlement) {
        ExternalSettlementRequest request = new ExternalSettlementRequest();
        request.setSettlementId(settlement.getSettlementId());
        request.setTradeId(settlement.getTradeId());
        request.setIsin(settlement.getIsin());
        request.setAmount(settlement.getSettlementAmount());
        request.setCurrency(settlement.getCurrency() != null ? settlement.getCurrency() : "USD");
        request.setCounterparty(settlement.getCounterparty());
        request.setSettlementMethod(settlement.getSettlementMethod() != null ? settlement.getSettlementMethod() : "DTC");
        request.setSettlementDate(settlement.getSettlementDate());
        return request;
    }

    private ExternalSettlementConfirmResponse buildMockConfirmation(Settlement settlement) {
        ExternalSettlementConfirmResponse response = new ExternalSettlementConfirmResponse();
        response.setExternalRef("EXT-MOCK-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase());
        response.setSettlementId(settlement.getSettlementId());
        response.setStatus("CONFIRMED");
        response.setSettledAmount(settlement.getSettlementAmount());
        response.setCurrency(settlement.getCurrency() != null ? settlement.getCurrency() : "USD");
        response.setClearingHouse(settlement.getSettlementMethod() != null ? settlement.getSettlementMethod() : "DTC");
        response.setConfirmedAt(LocalDateTime.now());
        return response;
    }

    private boolean isValidSettlement(Settlement settlement) {
        // Check ISIN format
        String isin = settlement.getIsin();
        if (isin == null || !isin.matches("^[A-Z]{2}[A-Z0-9]{9}[0-9]$")) {
            return false;
        }
        // Check required fields
        return settlement.getSettlementAmount() > 0 &&
               settlement.getTradeId() != null &&
               !settlement.getTradeId().isEmpty();
    }
    
    public List<Settlement> getSettlements() {
        return new ArrayList<>(settlements.values());
    }
    
    public Settlement getSettlement(String settlementId) {
        return settlements.get(settlementId);
    }
    
    public List<Settlement> getSettlementsByTradeId(String tradeId) {
        List<Settlement> result = new ArrayList<>();
        for (Settlement settlement : settlements.values()) {
            if (tradeId.equals(settlement.getTradeId())) {
                result.add(settlement);
            }
        }
        return result;
    }
}
