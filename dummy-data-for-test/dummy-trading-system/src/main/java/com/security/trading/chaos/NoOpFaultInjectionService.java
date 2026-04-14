package com.security.trading.chaos;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

/**
 * No-op fault injector used in all profiles <em>except</em> {@code chaos}.
 * Ensures {@link FaultInjectionService} is always injectable without requiring
 * callers to guard against a missing bean.
 */
@Service
@Profile("!chaos")
public class NoOpFaultInjectionService implements FaultInjectionService {

    @Override
    public void checkFault(String operationKey) {
        // intentional no-op outside the chaos profile
    }
}
