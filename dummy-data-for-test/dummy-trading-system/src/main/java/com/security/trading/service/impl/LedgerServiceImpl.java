package com.security.trading.service.impl;

import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;


import com.security.trading.service.LedgerService;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class LedgerServiceImpl implements LedgerService {

    private static final Logger logger = LogManager.getLogger(LedgerService.class);

    private final ConcurrentHashMap<String, JournalEntry> journalEntries = new ConcurrentHashMap<>();

    public JournalEntry createJournalEntry(JournalEntry entry) {
        // Generate entry ID if not provided
        if (entry.getEntryId() == null) {
            entry.setEntryId("JRNL-" + LocalDateTime.now().getYear() + "-" + String.format("%05d", journalEntries.size() + 1));
        }

        // Set timestamp if not provided
        if (entry.getTimestamp() == null) {
            entry.setTimestamp(LocalDateTime.now());
        }

        // Double-entry balance check: debits must equal credits
        if (entry.getDebit() != entry.getCredit()) {
            double imbalance = Math.abs(entry.getDebit() - entry.getCredit());
            logger.error("Double-entry bookkeeping IMBALANCE: date={}, totalDebits={}, totalCredits={}, imbalance={}, exception=ReconciliationException",
                    entry.getTimestamp().toLocalDate(),
                    String.format("%.2f", entry.getDebit()),
                    String.format("%.2f", entry.getCredit()),
                    String.format("%.2f", imbalance));
            logger.info("Initiating ledger recount: scanningPeriod={} to {}, expectedReconciliation={}",
                    entry.getTimestamp().toLocalDate().atStartOfDay(),
                    LocalDateTime.now(),
                    LocalDateTime.now().plusMinutes(30));
        } else {
            logger.info("[{}] Journal entry created: tradeId={}, debit={}, credit={}, account={}, balanced=true",
                    entry.getEntryId(), entry.getTradeId(),
                    String.format("%.2f", entry.getDebit()),
                    String.format("%.2f", entry.getCredit()),
                    entry.getAccount());
        }

        // Store journal entry
        journalEntries.put(entry.getEntryId(), entry);

        return entry;
    }
    
    public List<JournalEntry> getJournalEntries() {
        return new ArrayList<>(journalEntries.values());
    }
    
    public List<JournalEntry> getJournalEntriesByTradeId(String tradeId) {
        List<JournalEntry> result = new ArrayList<>();
        for (JournalEntry entry : journalEntries.values()) {
            if (tradeId.equals(entry.getTradeId())) {
                result.add(entry);
            }
        }
        return result;
    }
    
    public PnLReport generatePnLReport(String period) {
        PnLReport report = new PnLReport();
        report.setReportId("PNL-" + LocalDateTime.now().getYear() + "-" + String.format("%05d", 1));
        report.setPeriod(period);
        report.setGeneratedAt(LocalDateTime.now());

        // Simulate PnL calculation
        report.setTotalPnL(100000 + Math.random() * 50000);
        report.setRealizedPnL(80000 + Math.random() * 30000);
        report.setUnrealizedPnL(20000 + Math.random() * 20000);
        report.setTradingFees(5000 + Math.random() * 2000);
        report.setNetPnL(report.getTotalPnL() - report.getTradingFees());

        logger.info("PnL report generated: id={}, period={}, totalPnL={}, realizedPnL={}, unrealizedPnL={}, fees={}, netPnL={}",
                report.getReportId(), period,
                String.format("%.2f", report.getTotalPnL()),
                String.format("%.2f", report.getRealizedPnL()),
                String.format("%.2f", report.getUnrealizedPnL()),
                String.format("%.2f", report.getTradingFees()),
                String.format("%.2f", report.getNetPnL()));

        return report;
    }

    public NavReport calculateNAV() {
        NavReport report = new NavReport();
        report.setReportId("NAV-" + LocalDateTime.now().getYear() + "-" + String.format("%05d", 1));
        report.setCalculatedAt(LocalDateTime.now());

        // Simulate NAV calculation
        report.setTotalAssets(10000000 + Math.random() * 5000000);
        report.setTotalLiabilities(2000000 + Math.random() * 1000000);
        report.setNetAssetValue(report.getTotalAssets() - report.getTotalLiabilities());
        report.setTotalShares(1000000);
        report.setNavPerShare(report.getNetAssetValue() / report.getTotalShares());

        logger.info("NAV calculated: id={}, totalAssets={}, totalLiabilities={}, NAV={}, navPerShare={}",
                report.getReportId(),
                String.format("%.2f", report.getTotalAssets()),
                String.format("%.2f", report.getTotalLiabilities()),
                String.format("%.2f", report.getNetAssetValue()),
                String.format("%.4f", report.getNavPerShare()));

        return report;
    }

    /**
     * Run end-of-day pre-check: detect position mismatches with custodian records.
     */
    public void runEodPreCheck(String custodianId, int discrepancyCount, double totalDiscrepancyValue, List<String> affectedTradeIds) {
        if (discrepancyCount > 0) {
            logger.error("EOD pre-check FAILED: mismatched positions detected for custodianId={}, discrepancyCount={}, totalDiscrepancyValue={}",
                    custodianId, discrepancyCount, String.format("%.2f", totalDiscrepancyValue));
            logger.warn("EOD reconciliation will be delayed: estimatedCompletion={}, affected trade IDs: {}",
                    LocalDateTime.now().plusHours(1),
                    affectedTradeIds);
        } else {
            logger.info("EOD pre-check PASSED: custodianId={}, positions fully matched", custodianId);
        }
    }
}
