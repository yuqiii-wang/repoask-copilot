package com.security.trading.exception;

public class TradingException extends RuntimeException {

    private final String errorCode;

    public TradingException(String message) {
        super(message);
        this.errorCode = "TRADING_ERROR";
    }

    public TradingException(String errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    public TradingException(String errorCode, String message, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
    }

    public String getErrorCode() {
        return errorCode;
    }
}
