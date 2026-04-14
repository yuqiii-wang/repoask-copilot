package com.security.trading.service;

import com.security.trading.model.dto.NavReport;
import com.security.trading.model.dto.PnLReport;
import com.security.trading.model.entity.JournalEntry;

import java.util.List;

public interface LedgerService {
    JournalEntry createJournalEntry(JournalEntry entry);
    List<JournalEntry> getJournalEntries();
    List<JournalEntry> getJournalEntriesByTradeId(String tradeId);
    PnLReport generatePnLReport(String period);
    NavReport calculateNAV();
}
