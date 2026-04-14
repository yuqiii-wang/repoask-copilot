package com.security.trading.exception;

public class ResourceNotFoundException extends TradingException {

    public ResourceNotFoundException(String resourceType, String id) {
        super("RESOURCE_NOT_FOUND", resourceType + " not found: " + id);
    }
}
