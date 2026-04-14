package com.security.trading.service;

import com.security.trading.model.dto.BondCalculationRequest;
import com.security.trading.model.dto.BondCalculationResult;
import com.security.trading.model.entity.BondTrade;

import java.util.List;

public interface FixedIncomeService {
    BondTrade executeTrade(BondTrade trade);
    BondCalculationResult calculateBondMetrics(BondCalculationRequest request);
    List<BondTrade> getTrades();
    BondTrade getTrade(String tradeId);
}
