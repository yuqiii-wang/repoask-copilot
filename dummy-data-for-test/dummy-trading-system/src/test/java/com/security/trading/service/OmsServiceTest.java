package com.security.trading.service;


import com.security.trading.service.impl.OmsServiceImpl;
import com.security.trading.model.entity.*;
import com.security.trading.model.dto.*;
import com.security.trading.service.*;
import com.security.trading.service.impl.*;

import com.security.trading.service.OmsService;
import com.security.trading.model.entity.Order;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class OmsServiceTest {

    private OmsServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new OmsServiceImpl();
    }

    @Test
    void createOrder_limitOrderSmallNotional_routedToSmartOrderRouter() {
        Order order = buildOrder("AAPL", "BUY", 100, 100.0, "LIMIT", "DAY");

        Order result = service.createOrder(order);

        assertThat(result.getOrderId()).startsWith("OMS-");
        assertThat(result.getRoutingInstructions()).isEqualTo("SMART_ORDER_ROUTER");
        assertThat(result.getCreatedAt()).isNotNull();
        assertThat(result.getUpdatedAt()).isNotNull();
    }

    @Test
    void createOrder_largeNotional_routedToDarkPool() {
        // notional = 1000 * 600 = 600,000 > 500,000 threshold
        Order order = buildOrder("GOOGL", "BUY", 1000, 600.0, "LIMIT", "DAY");

        Order result = service.createOrder(order);

        assertThat(result.getRoutingInstructions()).isEqualTo("DARK_POOL");
    }

    @Test
    void createOrder_highQuantity_routedToAlgoEngine() {
        // qty 5000 >= ALGO_EXECUTION_THRESHOLD, notional = 5000 * 10 = 50,000 (below block threshold)
        Order order = buildOrder("MSFT", "BUY", 5000, 10.0, "LIMIT", "DAY");

        Order result = service.createOrder(order);

        assertThat(result.getRoutingInstructions()).startsWith("ALGO_ENGINE");
    }

    @Test
    void createOrder_marketOrder_routedToDma() {
        Order order = buildOrder("IBM", "SELL", 100, 150.0, "MARKET", "DAY");

        Order result = service.createOrder(order);

        assertThat(result.getRoutingInstructions()).isEqualTo("DMA");
    }

    @Test
    void createOrder_withAlgoSpecified_routedToAlgoEngine() {
        Order order = buildOrder("AMZN", "BUY", 200, 180.0, "LIMIT", "DAY");
        order.setAlgorithm("TWAP");

        Order result = service.createOrder(order);

        assertThat(result.getRoutingInstructions()).startsWith("ALGO_ENGINE:TWAP");
    }

    @Test
    void createOrder_duplicateClientOrderId_rejectsSecond() {
        Order first = buildOrder("AAPL", "BUY", 10, 175.0, "LIMIT", "DAY");
        first.setClientOrderId("CLIENT-001");
        service.createOrder(first);

        Order duplicate = buildOrder("AAPL", "BUY", 10, 175.0, "LIMIT", "DAY");
        duplicate.setClientOrderId("CLIENT-001");
        Order result = service.createOrder(duplicate);

        assertThat(result.getStatus()).isEqualTo("REJECTED");
    }

    @Test
    void createOrder_keepsExistingOrderId() {
        Order order = buildOrder("TSLA", "SELL", 50, 200.0, "LIMIT", "DAY");
        order.setOrderId("OMS-CUSTOM-001");

        Order result = service.createOrder(order);

        assertThat(result.getOrderId()).isEqualTo("OMS-CUSTOM-001");
    }

    @Test
    void cancelOrder_pendingOrder_setsCancelled() {
        Order order = buildOrder("AAPL", "BUY", 100, 170.0, "LIMIT", "GTC");
        Order created = service.createOrder(order);
        created.setStatus("PENDING"); // ensure it's not yet executed

        Order cancelled = service.cancelOrder(created.getOrderId());

        assertThat(cancelled).isNotNull();
        assertThat(cancelled.getStatus()).isEqualTo("CANCELLED");
    }

    @Test
    void cancelOrder_executedOrder_doesNotChangStatus() {
        Order order = buildOrder("AAPL", "BUY", 100, 170.0, "LIMIT", "GTC");
        Order created = service.createOrder(order);
        created.setStatus("EXECUTED");

        Order result = service.cancelOrder(created.getOrderId());

        // EXECUTED orders cannot be cancelled
        assertThat(result.getStatus()).isEqualTo("EXECUTED");
    }

    @Test
    void cancelOrder_unknownId_returnsNull() {
        assertThat(service.cancelOrder("UNKNOWN-ORDER")).isNull();
    }

    @Test
    void getOrders_returnsAllCreatedOrders() {
        service.createOrder(buildOrder("AAPL", "BUY", 10, 175.0, "LIMIT", "DAY"));
        service.createOrder(buildOrder("MSFT", "SELL", 20, 380.0, "LIMIT", "DAY"));

        List<Order> orders = service.getOrders();

        assertThat(orders).hasSize(2);
    }

    @Test
    void getOrder_returnsOrderById() {
        Order created = service.createOrder(buildOrder("AMZN", "BUY", 5, 185.0, "LIMIT", "DAY"));

        Order found = service.getOrder(created.getOrderId());

        assertThat(found).isNotNull();
        assertThat(found.getSymbol()).isEqualTo("AMZN");
    }

    private Order buildOrder(String symbol, String side, int qty, double price, String orderType, String tif) {
        Order o = new Order();
        o.setSymbol(symbol);
        o.setSide(side);
        o.setQuantity(qty);
        o.setPrice(price);
        o.setOrderType(orderType);
        o.setTimeInForce(tif);
        return o;
    }
}
