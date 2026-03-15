package com.security.trading.ledger;

import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class LedgerService {
    
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
        
        return report;
    }
}
