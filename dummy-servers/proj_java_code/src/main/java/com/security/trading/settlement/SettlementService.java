package com.security.trading.settlement;

import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class SettlementService {
    
    private final ConcurrentHashMap<String, Settlement> settlements = new ConcurrentHashMap<>();
    
    public Settlement createSettlement(Settlement settlement) {
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
    
    public Settlement processSettlement(String settlementId) {
        Settlement settlement = settlements.get(settlementId);
        if (settlement != null) {
            // Simulate settlement processing
            if (Math.random() > 0.1) { // 90% success rate
                settlement.setStatus("PROCESSED");
            } else {
                settlement.setStatus("FAILED");
                settlement.setFailureReason("Insufficient funds");
            }
            settlement.setUpdatedAt(LocalDateTime.now());
        }
        return settlement;
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
