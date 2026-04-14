package com.security.trading.chaos;

import com.security.trading.exception.DownstreamServerException;
import com.security.trading.exception.DownstreamTimeoutException;
import com.security.trading.exception.MissingArgumentException;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Chaos-engineering fault injector active only when the {@code chaos}
 * Spring profile is enabled.
 *
 * <h3>Behaviour</h3>
 * <ul>
 *   <li>Odd call numbers (1st, 3rd, 5th, …) for a given {@code operationKey}
 *       throw a transient exception, simulating a real-world degraded
 *       downstream.</li>
 *   <li>Even call numbers (2nd, 4th, …) return normally — these represent the
 *       successful retry.</li>
 * </ul>
 *
 * <h3>Fault assignment</h3>
 * Each operation key is deterministically mapped to one of three fault types
 * via its hash code, ensuring consistent behaviour across test runs:
 * <ol>
 *   <li>{@code TIMEOUT}       — {@link DownstreamTimeoutException}</li>
 *   <li>{@code MISSING_ARGS}  — {@link MissingArgumentException}</li>
 *   <li>{@code DOWNSTREAM_500}— {@link DownstreamServerException}</li>
 * </ol>
 *
 * <h3>Activation</h3>
 * Start the application with {@code --spring.profiles.active=chaos} or set
 * {@code SPRING_PROFILES_ACTIVE=chaos} in the environment.
 */
@Service
@Profile("chaos")
public class ChaosEngineFaultInjectionService implements FaultInjectionService {

    private static final Logger logger = LogManager.getLogger(ChaosEngineFaultInjectionService.class);

    private enum FaultType { TIMEOUT, MISSING_ARGS, DOWNSTREAM_500 }

    /** Per-operation call counter. Odd → fault; even → pass. */
    private final ConcurrentHashMap<String, AtomicInteger> callCounters = new ConcurrentHashMap<>();

    @Override
    public void checkFault(String operationKey) {
        int callNumber = callCounters
                .computeIfAbsent(operationKey, k -> new AtomicInteger(0))
                .incrementAndGet();

        boolean shouldFault = (callNumber % 2) == 1;   // 1st, 3rd, 5th … → inject fault

        if (!shouldFault) {
            logger.info("[CHAOS] Retry #{} PASSED for operation '{}' — fault window cleared",
                    callNumber, operationKey);
            return;
        }

        FaultType faultType = resolveFaultType(operationKey);
        logger.warn("[CHAOS] Injecting {} fault (call #{}) for operation '{}'",
                faultType, callNumber, operationKey);

        switch (faultType) {
            case TIMEOUT ->
                throw new DownstreamTimeoutException(operationKey);
            case MISSING_ARGS ->
                throw new MissingArgumentException(operationKey);
            case DOWNSTREAM_500 ->
                throw new DownstreamServerException(operationKey);
        }
    }

    /**
     * Deterministically assigns a fault type based on the operation key's hash
     * so the same operation always gets the same fault type across retries.
     */
    private FaultType resolveFaultType(String operationKey) {
        int index = Math.abs(operationKey.hashCode()) % FaultType.values().length;
        return FaultType.values()[index];
    }
}
