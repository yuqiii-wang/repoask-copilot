package com.security.trading.oms;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

@Service
public class OmsService {

    private static final Logger logger = LogManager.getLogger(OmsService.class);

    // Threshold above which algorithmic execution is preferred over DMA
    private static final int ALGO_EXECUTION_THRESHOLD = 5000;
    // Threshold above which block-trade routing applies
    private static final double BLOCK_TRADE_NOTIONAL = 500_000.0;
    // Circuit breaker: trips after this many consecutive failures
    private static final int CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
    // Circuit breaker cooldown in milliseconds
    private static final long CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;

    private final ConcurrentHashMap<String, Order> orders = new ConcurrentHashMap<>();
    // Tracks clientOrderId → internal orderId to detect duplicates
    private final ConcurrentHashMap<String, String> clientOrderIdIndex = new ConcurrentHashMap<>();

    // Circuit-breaker state per connector
    private final ConcurrentHashMap<String, AtomicInteger> connectorFailures = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, LocalDateTime> circuitOpenedAt = new ConcurrentHashMap<>();
    private final Set<String> openCircuits = ConcurrentHashMap.newKeySet();

    public Order createOrder(Order order) {
        if (order.getOrderId() == null) {
            order.setOrderId("OMS-" + LocalDateTime.now().getYear()
                    + "-" + String.format("%05d", orders.size() + 1));
        }
        LocalDateTime now = LocalDateTime.now();
        order.setCreatedAt(now);
        order.setUpdatedAt(now);
        if (order.getStatus() == null) {
            order.setStatus("PENDING");
        }

        // Duplicate order check
        if (order.getClientOrderId() != null) {
            String existingId = clientOrderIdIndex.putIfAbsent(order.getClientOrderId(), order.getOrderId());
            if (existingId != null) {
                logger.error("[{}] Duplicate order detected: clientOrderId={}, originalOrderId={}, action=REJECT_DUPLICATE",
                        order.getOrderId(), order.getClientOrderId(), existingId);
                order.setStatus("REJECTED");
                return order;
            }
        }

        logger.info("[{}] New order received: symbol={}, side={}, qty={}, price={}, type={}, TIF={}, algo={}",
                order.getOrderId(), order.getSymbol(), order.getSide(),
                order.getQuantity(), order.getPrice(), order.getOrderType(),
                order.getTimeInForce(), order.getAlgorithm());

        // Routing decision
        double notional = order.getQuantity() * order.getPrice();
        String route = determineRoute(order, notional);
        order.setRoutingInstructions(route);
        logger.info("[{}] Routing decision: notional={}, route={}", order.getOrderId(),
                String.format("%.2f", notional), route);

        orders.put(order.getOrderId(), order);
        simulateOrderExecution(order);
        return order;
    }

    private String determineRoute(Order order, double notional) {
        if (notional >= BLOCK_TRADE_NOTIONAL) {
            logger.info("[{}] Block trade detected (notional={} >= {}): routing to DARK_POOL",
                    order.getOrderId(), String.format("%.2f", notional), BLOCK_TRADE_NOTIONAL);
            return "DARK_POOL";
        }
        if (order.getQuantity() >= ALGO_EXECUTION_THRESHOLD || order.getAlgorithm() != null) {
            String algo = order.getAlgorithm() != null ? order.getAlgorithm() : "VWAP";
            logger.info("[{}] Large order (qty={} >= {}) or algo specified: routing to ALGO_ENGINE with {}",
                    order.getOrderId(), order.getQuantity(), ALGO_EXECUTION_THRESHOLD, algo);
            return "ALGO_ENGINE:" + algo;
        }
        if ("MARKET".equalsIgnoreCase(order.getOrderType())) {
            logger.debug("[{}] Market order, routing to DMA", order.getOrderId());
            return "DMA";
        }
        logger.debug("[{}] Limit order, routing to SMART_ORDER_ROUTER", order.getOrderId());
        return "SMART_ORDER_ROUTER";
    }

    public Order cancelOrder(String orderId) {
        Order order = orders.get(orderId);
        if (order != null) {
            if ("EXECUTED".equals(order.getStatus())) {
                logger.warn("[{}] Cancel request on already EXECUTED order — cancellation rejected", orderId);
            } else {
                order.setStatus("CANCELLED");
                order.setUpdatedAt(LocalDateTime.now());
                logger.info("[{}] Order cancelled", orderId);
            }
        } else {
            logger.error("[{}] Cancel request for unknown orderId", orderId);
        }
        return order;
    }

    private void simulateOrderExecution(Order order) {
        new Thread(() -> {
            try {
                int delayMs = 200 + (int) (Math.random() * 600);
                Thread.sleep(delayMs);

                // Simulate 5% chance of FIX session disconnect
                if (Math.random() < 0.05) {
                    String connector = "FIX-BATS-01";
                    logger.error("[{}] Order EXECUTION FAILED: orderId={}, exception=ExchangeConnectivityException, msg=FIX session {} disconnected, retryAttempt=1/3",
                            order.getOrderId(), order.getOrderId(), connector);
                    logger.warn("[{}] Order held in SUSPENDED state pending reconnect (timeout={})",
                            order.getOrderId(), LocalDateTime.now().plusMinutes(1));
                    order.setStatus("SUSPENDED");
                    order.setUpdatedAt(LocalDateTime.now());
                    recordConnectorFailure(connector, order.getOrderId());
                    return;
                }

                double slippage = computeSlippage(order);

                // IOC partial fill simulation
                if ("IOC".equalsIgnoreCase(order.getTimeInForce()) && order.getQuantity() > 5000) {
                    int filledQty = (int) (order.getQuantity() * 0.75);
                    int remainingQty = order.getQuantity() - filledQty;
                    double fillPrice = order.getPrice() * (1.0 + slippage);
                    order.setFilledQuantity(filledQty);
                    order.setAveragePrice(fillPrice);
                    order.setUpdatedAt(LocalDateTime.now());
                    logger.info("[{}] Partial fill: filledQty={}, remainingQty={}, fillPrice={}, latencyMs={}",
                            order.getOrderId(), filledQty, remainingQty,
                            String.format("%.3f", fillPrice), delayMs);
                    order.setStatus("PARTIALLY_FILLED");
                    logger.info("[{}] IOC order: cancelled remaining {} shares (IOC expiry)",
                            order.getOrderId(), remainingQty);
                    order.setStatus("CANCELLED");
                    return;
                }

                double fillPrice = order.getPrice() * (1.0 + slippage);
                order.setStatus("EXECUTED");
                order.setFilledQuantity(order.getQuantity());
                order.setAveragePrice(fillPrice);
                order.setUpdatedAt(LocalDateTime.now());
                logger.info("[{}] Order EXECUTED: fillPrice={} (slippage={}bps), latencyMs={}",
                        order.getOrderId(), String.format("%.4f", fillPrice),
                        String.format("%.2f", slippage * 10_000), delayMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                logger.error("[{}] Execution thread interrupted", order.getOrderId());
            }
        }).start();
    }

    private void recordConnectorFailure(String connector, String orderId) {
        AtomicInteger failures = connectorFailures.computeIfAbsent(connector, k -> new AtomicInteger(0));
        int count = failures.incrementAndGet();
        if (count >= CIRCUIT_BREAKER_FAILURE_THRESHOLD && !openCircuits.contains(connector)) {
            openCircuits.add(connector);
            LocalDateTime resumeAt = LocalDateTime.now().plusMillis(CIRCUIT_BREAKER_COOLDOWN_MS);
            circuitOpenedAt.put(connector, LocalDateTime.now());
            logger.error("[{}] Circuit breaker TRIGGERED: {} failed orders in {} seconds on {} connector, pausing order acceptance until {}",
                    orderId, count, CIRCUIT_BREAKER_COOLDOWN_MS / 1000, connector, resumeAt);
            logger.warn("Circuit breaker state: OPEN, orders_in_queue={}, will retry after cooldown", 0);

            // Schedule recovery
            new Thread(() -> {
                try {
                    Thread.sleep(CIRCUIT_BREAKER_COOLDOWN_MS / 2);
                    logger.info("Circuit breaker state: HALF_OPEN, testing connectivity with probe order");
                    Thread.sleep(CIRCUIT_BREAKER_COOLDOWN_MS / 2);
                    openCircuits.remove(connector);
                    failures.set(0);
                    logger.info("Circuit breaker state: CLOSED, {} connectivity RESTORED, resuming queued orders", connector);
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                }
            }).start();
        }
    }

    // Simplified slippage: proportional to sqrt(qty/ADV)
    private double computeSlippage(Order order) {
        double adv = 50_000.0;
        double slippage = 0.0002 * Math.sqrt((double) order.getQuantity() / adv);
        logger.debug("[{}] Slippage estimate: 0.02% * sqrt({}/{}) = {}bps",
                order.getOrderId(), order.getQuantity(), adv,
                String.format("%.4f", slippage * 10_000));
        return slippage;
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
