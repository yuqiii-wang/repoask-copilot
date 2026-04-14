package com.security.trading.model.entity;

import com.security.trading.model.entity.Trade;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class BondTrade extends Trade {
    private String isin;
    private String bondType; // MUNICIPAL, CORPORATE, GOVERNMENT
    private double couponRate;
    private String maturityDate;
    private double yieldToMaturity;
    private double duration;
    private double convexity;
}
