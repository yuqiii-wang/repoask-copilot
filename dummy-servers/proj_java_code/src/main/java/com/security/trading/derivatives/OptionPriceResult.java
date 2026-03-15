package com.security.trading.derivatives;

import lombok.Data;

@Data
public class OptionPriceResult {
    private double optionPrice;
    private double delta;
    private double gamma;
    private double theta;
    private double vega;
    private double rho;
    private double impliedVolatility;
    private double timeValue;
    private double intrinsicValue;
}
