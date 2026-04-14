package com.security.trading.exception;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger logger = LogManager.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<Map<String, Object>> handleResourceNotFound(ResourceNotFoundException ex) {
        logger.warn("Resource not found: {}", ex.getMessage());
        return buildError(HttpStatus.NOT_FOUND, ex.getErrorCode(), ex.getMessage());
    }

    @ExceptionHandler(InvalidTradeException.class)
    public ResponseEntity<Map<String, Object>> handleInvalidTrade(InvalidTradeException ex) {
        logger.warn("Invalid trade: {}", ex.getMessage());
        return buildError(HttpStatus.BAD_REQUEST, ex.getErrorCode(), ex.getMessage());
    }

    @ExceptionHandler(DownstreamTimeoutException.class)
    public ResponseEntity<Map<String, Object>> handleDownstreamTimeout(DownstreamTimeoutException ex) {
        logger.error("[CHAOS] Downstream timeout [{}]: {}", ex.getErrorCode(), ex.getMessage());
        return buildError(HttpStatus.GATEWAY_TIMEOUT, ex.getErrorCode(), ex.getMessage());
    }

    @ExceptionHandler(MissingArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleMissingArgument(MissingArgumentException ex) {
        logger.error("[CHAOS] Missing argument [{}]: {}", ex.getErrorCode(), ex.getMessage());
        return buildError(HttpStatus.BAD_REQUEST, ex.getErrorCode(), ex.getMessage());
    }

    @ExceptionHandler(DownstreamServerException.class)
    public ResponseEntity<Map<String, Object>> handleDownstreamServer(DownstreamServerException ex) {
        logger.error("[CHAOS] Downstream 5xx [{}] (HTTP {}): {}", ex.getErrorCode(), ex.getHttpStatus(), ex.getMessage());
        return buildError(HttpStatus.BAD_GATEWAY, ex.getErrorCode(), ex.getMessage());
    }

    @ExceptionHandler(TradingException.class)
    public ResponseEntity<Map<String, Object>> handleTradingException(TradingException ex) {
        logger.error("Trading error [{}]: {}", ex.getErrorCode(), ex.getMessage());
        return buildError(HttpStatus.INTERNAL_SERVER_ERROR, ex.getErrorCode(), ex.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException ex) {
        String msg = ex.getBindingResult().getFieldErrors().stream()
                .map(e -> e.getField() + ": " + e.getDefaultMessage())
                .findFirst().orElse("Validation failed");
        return buildError(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", msg);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneric(Exception ex) {
        logger.error("Unexpected error", ex);
        return buildError(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "An unexpected error occurred");
    }

    private ResponseEntity<Map<String, Object>> buildError(HttpStatus status, String code, String message) {
        Map<String, Object> body = new HashMap<>();
        body.put("timestamp", LocalDateTime.now().toString());
        body.put("status", status.value());
        body.put("errorCode", code);
        body.put("message", message);
        return ResponseEntity.status(status).body(body);
    }
}
