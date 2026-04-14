package com.security.trading;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.retry.annotation.EnableRetry;

@SpringBootApplication
@EnableRetry
public class TradingSystemApplication {

    private static final Logger logger = LogManager.getLogger(TradingSystemApplication.class);
    private static final String VERSION = "2.7.1-RELEASE";

    public static void main(String[] args) {
        logger.info("Starting TradingSystemApplication v{}", VERSION);
        SpringApplication.run(TradingSystemApplication.class, args);
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        logger.info("TradingSystemApplication v{} started successfully - all subsystems initialised", VERSION);
    }
}
