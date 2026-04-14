package com.security.trading.controller;

import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;

import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/ledger")
public class LedgerController {
    
    private final LedgerService ledgerService;
    
    public LedgerController(LedgerService ledgerService) {
        this.ledgerService = ledgerService;
    }
    
    @PostMapping("/entry")
    public JournalEntry createJournalEntry(@RequestBody JournalEntry entry) {
        return ledgerService.createJournalEntry(entry);
    }
    
    @GetMapping("/entries")
    public List<JournalEntry> getJournalEntries() {
        return ledgerService.getJournalEntries();
    }
    
    @GetMapping("/entries/trade/{tradeId}")
    public List<JournalEntry> getJournalEntriesByTradeId(@PathVariable String tradeId) {
        return ledgerService.getJournalEntriesByTradeId(tradeId);
    }
    
    @GetMapping("/pnl")
    public PnLReport getPnLReport(@RequestParam String period) {
        return ledgerService.generatePnLReport(period);
    }
    
    @GetMapping("/nav")
    public NavReport getNavReport() {
        return ledgerService.calculateNAV();
    }
}
