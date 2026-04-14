package com.security.trading.client;

import com.security.trading.client.dto.ExternalSettlementConfirmResponse;
import com.security.trading.client.dto.ExternalSettlementRequest;

/**
 * Contract for the external settlement / clearing gateway (DTCC / SWIFT mock).
 * Implementations call the remote gateway via HTTP.
 */
public interface SettlementGatewayFeignClient {

    ExternalSettlementConfirmResponse confirmSettlement(ExternalSettlementRequest request);

    ExternalSettlementConfirmResponse getSettlementStatus(String externalRef);
}
