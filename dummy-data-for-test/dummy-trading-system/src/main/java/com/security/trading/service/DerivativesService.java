package com.security.trading.service;

import com.security.trading.model.dto.OptionPriceRequest;
import com.security.trading.model.dto.OptionPriceResult;
import com.security.trading.model.entity.OptionTrade;

import java.util.List;

public interface DerivativesService {
    OptionTrade executeTrade(OptionTrade trade);
    OptionPriceResult priceOption(OptionPriceRequest request);
    List<OptionTrade> getTrades();
    OptionTrade getTrade(String tradeId);
}
