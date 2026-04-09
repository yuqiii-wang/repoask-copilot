package com.security.trading.fixedincome;

import lombok.Data;

@Data
public class BondCalculationRequest {
    private String isin;
    private String settlementDate;
    private double faceValue;
    private double couponRate;
    private String maturityDate;
    private double marketPrice;
    // Maturity in years for yield curve interpolation (max supported: 30Y)
    private int maturityYears;
}
