package com.security.trading.model.entity;

import com.security.trading.model.entity.Trade;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class OptionTrade extends Trade {
    private String optionType; // CALL, PUT
    private String underlying; // Underlying asset symbol
    private double strikePrice;
    private String expirationDate;
    private String optionStyle; // AMERICAN, EUROPEAN
    private double impliedVolatility;
    private double delta;
    private double gamma;
    private double theta;
    private double vega;
    private double rho;
}
