package com.security.trading.model.dto;

import lombok.Data;

@Data
public class BacktestResult {
    private String backtestId;
    private String strategyId;
    private double totalReturn;
    private double sharpeRatio;
    private double maxDrawdown;
    private int totalTrades;
    private double winRate;
    private double averageWin;
    private double averageLoss;
    private double finalCapital;
}
