package com.security.trading.fixedincome;

import com.security.trading.common.Trade;
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
