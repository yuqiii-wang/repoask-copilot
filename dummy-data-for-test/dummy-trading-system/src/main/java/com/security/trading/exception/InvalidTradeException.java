package com.security.trading.exception;

public class InvalidTradeException extends TradingException {

    public InvalidTradeException(String message) {
        super("INVALID_TRADE", message);
    }
}
