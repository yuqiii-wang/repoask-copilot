package com.security.trading.chaos;

/**
 * Contract for fault injection. In the {@code chaos} Spring profile the
 * active implementation deliberately throws transient exceptions so that
 * retry / error-handling logic can be exercised.  Outside that profile a
 * no-op implementation is used so production behaviour is unchanged.
 */
public interface FaultInjectionService {

    /**
     * Potentially inject a fault for the given {@code operationKey}.
     * <p>
     * On the <em>first</em> call for a key a {@link com.security.trading.exception.TradingException}
     * sub-type is thrown; on the <em>second</em> call (i.e. the retry) the
     * method returns normally, allowing the operation to succeed.
     *
     * @param operationKey logical name of the operation being guarded
     */
    void checkFault(String operationKey);
}
