package com.security.trading.service;


import com.security.trading.service.impl.LedgerServiceImpl;
import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;
import com.security.trading.service.impl.*;

import com.security.trading.model.entity.JournalEntry;
import com.security.trading.service.LedgerService;
import com.security.trading.model.dto.NavReport;
import com.security.trading.model.dto.PnLReport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class LedgerServiceTest {

    private LedgerServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new LedgerServiceImpl();
    }

    @Test
    void createJournalEntry_balanced_generatesIdAndStores() {
        JournalEntry entry = buildEntry("TRD-001", "EQUITY_DESK", 1000.0, 1000.0, "TRADE");

        JournalEntry result = service.createJournalEntry(entry);

        assertThat(result.getEntryId()).isNotBlank().startsWith("JRNL-");
        assertThat(result.getTimestamp()).isNotNull();
    }

    @Test
    void createJournalEntry_imbalanced_stillStores() {
        JournalEntry entry = buildEntry("TRD-002", "FEE_ACCOUNT", 1000.0, 900.0, "FEE");

        JournalEntry result = service.createJournalEntry(entry);

        assertThat(result.getEntryId()).isNotBlank();
        assertThat(result.getDebit()).isNotEqualTo(result.getCredit());
    }

    @Test
    void createJournalEntry_keepsExistingId() {
        JournalEntry entry = buildEntry("TRD-003", "FX_DESK", 500.0, 500.0, "TRADE");
        entry.setEntryId("JRNL-CUSTOM-001");

        JournalEntry result = service.createJournalEntry(entry);

        assertThat(result.getEntryId()).isEqualTo("JRNL-CUSTOM-001");
    }

    @Test
    void getJournalEntries_returnsAllEntries() {
        service.createJournalEntry(buildEntry("TRD-A", "EQUITY", 100.0, 100.0, "TRADE"));
        service.createJournalEntry(buildEntry("TRD-B", "FX", 200.0, 200.0, "TRADE"));

        List<JournalEntry> all = service.getJournalEntries();

        assertThat(all).hasSize(2);
    }

    @Test
    void getJournalEntriesByTradeId_returnsMatchingEntries() {
        service.createJournalEntry(buildEntry("TRD-LINK", "EQUITY", 100.0, 100.0, "TRADE"));
        service.createJournalEntry(buildEntry("TRD-LINK", "BOND", 200.0, 200.0, "SETTLEMENT"));
        service.createJournalEntry(buildEntry("TRD-OTHER", "FX", 300.0, 300.0, "TRADE"));

        List<JournalEntry> result = service.getJournalEntriesByTradeId("TRD-LINK");

        assertThat(result).hasSize(2);
        assertThat(result).allMatch(e -> "TRD-LINK".equals(e.getTradeId()));
    }

    @Test
    void getJournalEntriesByTradeId_returnsEmptyIfNoMatch() {
        assertThat(service.getJournalEntriesByTradeId("NONEXISTENT")).isEmpty();
    }

    @Test
    void generatePnLReport_hasPositiveTotalPnLAndValidId() {
        PnLReport report = service.generatePnLReport("2026-04");

        assertThat(report.getReportId()).isNotBlank().startsWith("PNL-");
        assertThat(report.getPeriod()).isEqualTo("2026-04");
        assertThat(report.getTotalPnL()).isGreaterThan(0);
        assertThat(report.getRealizedPnL()).isGreaterThan(0);
        assertThat(report.getUnrealizedPnL()).isGreaterThan(0);
        assertThat(report.getTradingFees()).isGreaterThan(0);
        assertThat(report.getNetPnL()).isGreaterThan(0);
        assertThat(report.getGeneratedAt()).isNotNull();
    }

    @Test
    void calculateNAV_hasPositiveNavPerShareAndValidId() {
        NavReport report = service.calculateNAV();

        assertThat(report.getReportId()).isNotBlank().startsWith("NAV-");
        assertThat(report.getTotalAssets()).isGreaterThan(0);
        assertThat(report.getNetAssetValue()).isGreaterThan(0);
        assertThat(report.getNavPerShare()).isGreaterThan(0);
        assertThat(report.getCalculatedAt()).isNotNull();
    }

    private JournalEntry buildEntry(String tradeId, String account, double debit, double credit, String type) {
        JournalEntry e = new JournalEntry();
        e.setTradeId(tradeId);
        e.setAccount(account);
        e.setDebit(debit);
        e.setCredit(credit);
        e.setCurrency("USD");
        e.setDescription("Test entry for " + tradeId);
        e.setEntryType(type);
        return e;
    }
}
