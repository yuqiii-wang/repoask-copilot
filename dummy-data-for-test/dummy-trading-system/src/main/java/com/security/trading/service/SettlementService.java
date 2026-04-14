package com.security.trading.service;

import com.security.trading.model.entity.Settlement;

import java.util.List;

public interface SettlementService {
    Settlement createSettlement(Settlement settlement);
    Settlement processSettlement(String settlementId);
    List<Settlement> getSettlements();
    Settlement getSettlement(String settlementId);
    List<Settlement> getSettlementsByTradeId(String tradeId);
}
