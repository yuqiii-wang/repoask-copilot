package com.security.trading.oms;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@RequestMapping("/api/oms")
public class OmsController {

    private static final Logger logger = LogManager.getLogger(OmsController.class);

    private final OmsService omsService;

    public OmsController(OmsService omsService) {
        this.omsService = omsService;
    }

    @PostMapping("/order")
    public Order createOrder(@RequestBody Order order) {
        if (order.getSymbol() == null || order.getSymbol().isBlank()) {
            logger.error("Invalid order request: symbol field is null or empty. Request: {{side={}, qty={}, price={}}}",
                    order.getSide(), order.getQuantity(), order.getPrice());
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "symbol field is null or empty");
        }
        if (order.getPrice() < 0) {
            logger.warn("Order price validation warning: price={} is negative, rejecting order for symbol={}",
                    order.getPrice(), order.getSymbol());
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "price cannot be negative");
        }
    
    @PutMapping("/order/{orderId}/cancel")
    public Order cancelOrder(@PathVariable String orderId) {
        return omsService.cancelOrder(orderId);
    }
    
    @GetMapping("/orders")
    public List<Order> getOrders() {
        return omsService.getOrders();
    }
    
    @GetMapping("/orders/{orderId}")
    public Order getOrder(@PathVariable String orderId) {
        return omsService.getOrder(orderId);
    }
    
    @GetMapping("/orders/trade/{tradeId}")
    public List<Order> getOrdersByTradeId(@PathVariable String tradeId) {
        return omsService.getOrdersByTradeId(tradeId);
    }
}
