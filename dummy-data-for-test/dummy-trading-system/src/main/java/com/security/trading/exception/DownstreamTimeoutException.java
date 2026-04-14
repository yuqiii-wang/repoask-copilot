package com.security.trading.exception;

public class DownstreamTimeoutException extends TradingException {

    public DownstreamTimeoutException(String operation) {
        super("DOWNSTREAM_TIMEOUT",
              "Downstream service timed out after 30000 ms while executing: " + operation);
    }

    public DownstreamTimeoutException(String operation, Throwable cause) {
        super("DOWNSTREAM_TIMEOUT",
              "Downstream service timed out after 30000 ms while executing: " + operation, cause);
    }
}
