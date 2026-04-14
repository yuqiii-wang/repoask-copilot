package com.security.trading.exception;

public class DownstreamServerException extends TradingException {

    private final int httpStatus;

    public DownstreamServerException(String operation) {
        super("DOWNSTREAM_5XX",
              "Downstream service returned HTTP 500 for operation: " + operation);
        this.httpStatus = 500;
    }

    public DownstreamServerException(String operation, int httpStatus) {
        super("DOWNSTREAM_5XX",
              "Downstream service returned HTTP " + httpStatus + " for operation: " + operation);
        this.httpStatus = httpStatus;
    }

    public int getHttpStatus() {
        return httpStatus;
    }
}
