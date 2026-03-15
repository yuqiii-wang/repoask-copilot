package com.security.trading.derivatives;

import lombok.Data;

@Data
public class OptionPriceRequest {
    private String optionType; // CALL, PUT
    private String underlying;
    private double strikePrice;
    private String expirationDate;
    private String optionStyle; // AMERICAN, EUROPEAN
    private double underlyingPrice;
    private double riskFreeRate;
    private double impliedVolatility;
}
