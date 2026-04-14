package com.security.trading.exception;

public class MissingArgumentException extends TradingException {

    public MissingArgumentException(String argument) {
        super("MISSING_ARGUMENT",
              "Required argument is null or blank: " + argument);
    }
}
