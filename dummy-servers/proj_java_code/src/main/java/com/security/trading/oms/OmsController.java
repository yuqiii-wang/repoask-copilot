package com.security.trading.oms;

import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/oms")
public class OmsController {
    
    private final OmsService omsService;
    
    public OmsController(OmsService omsService) {
        this.omsService = omsService;
    }
    
    @PostMapping("/order")
    public Order createOrder(@RequestBody Order order) {
        return omsService.createOrder(order);
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
