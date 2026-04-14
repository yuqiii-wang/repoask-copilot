package com.security.trading.service;

import com.security.trading.model.entity.Order;

import java.util.List;

public interface OmsService {
    Order createOrder(Order order);
    Order cancelOrder(String orderId);
    List<Order> getOrders();
    Order getOrder(String orderId);
    List<Order> getOrdersByTradeId(String tradeId);
}
