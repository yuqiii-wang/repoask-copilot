package com.security.trading.oms;

import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class OmsService {
    
    private final ConcurrentHashMap<String, Order> orders = new ConcurrentHashMap<>();
    
    public Order createOrder(Order order) {
        // Generate order ID if not provided
        if (order.getOrderId() == null) {
            order.setOrderId("OMS-" + LocalDateTime.now().getYear() + "-" + String.format("%05d", orders.size() + 1));
        }
        
        // Set timestamps
        LocalDateTime now = LocalDateTime.now();
        order.setCreatedAt(now);
        order.setUpdatedAt(now);
        
        // Set initial status
        if (order.getStatus() == null) {
            order.setStatus("PENDING");
        }
        
        // Store order
        orders.put(order.getOrderId(), order);
        
        // Simulate order execution
        simulateOrderExecution(order);
        
        return order;
    }
    
    public Order cancelOrder(String orderId) {
        Order order = orders.get(orderId);
        if (order != null) {
            order.setStatus("CANCELLED");
            order.setUpdatedAt(LocalDateTime.now());
        }
        return order;
    }
    
    private void simulateOrderExecution(Order order) {
        // Simulate order execution after a short delay
        new Thread(() -> {
            try {
                Thread.sleep(500); // Simulate processing time
                order.setStatus("EXECUTED");
                order.setFilledQuantity(order.getQuantity());
                order.setAveragePrice(order.getPrice());
                order.setUpdatedAt(LocalDateTime.now());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }).start();
    }
    
    public List<Order> getOrders() {
        return new ArrayList<>(orders.values());
    }
    
    public Order getOrder(String orderId) {
        return orders.get(orderId);
    }
    
    public List<Order> getOrdersByTradeId(String tradeId) {
        List<Order> result = new ArrayList<>();
        for (Order order : orders.values()) {
            if (tradeId.equals(order.getTradeId())) {
                result.add(order);
            }
        }
        return result;
    }
}
