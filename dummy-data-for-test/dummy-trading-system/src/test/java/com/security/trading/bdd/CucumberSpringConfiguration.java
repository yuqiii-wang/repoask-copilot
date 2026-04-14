package com.security.trading.bdd;

import io.cucumber.spring.CucumberContextConfiguration;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Spring context configuration for Cucumber BDD tests.
 * Uses NONE web environment so no embedded server is started —
 * tests connect to the externally-running server at localhost:8080.
 *
 * Additional Kafka / RabbitMQ auto-configurations are excluded because no
 * brokers are available during BDD runs. The Spring Cloud compatibility
 * exclusion (LifecycleMvcEndpointAutoConfiguration) is handled globally via
 * application.properties and is also listed here as a belt-and-suspenders guard.
 */
@CucumberContextConfiguration
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.NONE,
        properties = {
                "spring.autoconfigure.exclude=" +
                        "org.springframework.boot.autoconfigure.kafka.KafkaAutoConfiguration," +
                        "org.springframework.boot.autoconfigure.amqp.RabbitAutoConfiguration," +
                        "org.springframework.cloud.autoconfigure.ConfigurationPropertiesRebinderAutoConfiguration," +
                        "org.springframework.cloud.autoconfigure.LifecycleMvcEndpointAutoConfiguration," +
                        "org.springframework.cloud.autoconfigure.RefreshAutoConfiguration," +
                        "org.springframework.cloud.autoconfigure.RefreshEndpointAutoConfiguration," +
                        "org.springframework.cloud.autoconfigure.WritableEnvironmentEndpointAutoConfiguration," +
                        "org.springframework.cloud.client.CommonsClientAutoConfiguration," +
                        "org.springframework.cloud.client.ReactiveCommonsClientAutoConfiguration," +
                        "org.springframework.cloud.client.discovery.composite.CompositeDiscoveryClientAutoConfiguration," +
                        "org.springframework.cloud.client.discovery.composite.reactive.ReactiveCompositeDiscoveryClientAutoConfiguration," +
                        "org.springframework.cloud.client.discovery.simple.SimpleDiscoveryClientAutoConfiguration," +
                        "org.springframework.cloud.client.discovery.simple.reactive.SimpleReactiveDiscoveryClientAutoConfiguration," +
                        "org.springframework.cloud.client.hypermedia.CloudHypermediaAutoConfiguration," +
                        "org.springframework.cloud.client.loadbalancer.LoadBalancerAutoConfiguration," +
                        "org.springframework.cloud.client.loadbalancer.LoadBalancerDefaultMappingsProviderAutoConfiguration," +
                        "org.springframework.cloud.client.loadbalancer.reactive.LoadBalancerBeanPostProcessorAutoConfiguration," +
                        "org.springframework.cloud.client.loadbalancer.reactive.ReactorLoadBalancerClientAutoConfiguration," +
                        "org.springframework.cloud.client.serviceregistry.ServiceRegistryAutoConfiguration," +
                        "org.springframework.cloud.commons.util.UtilAutoConfiguration," +
                        "org.springframework.cloud.configuration.CompatibilityVerifierAutoConfiguration," +
                        "org.springframework.cloud.client.serviceregistry.AutoServiceRegistrationAutoConfiguration," +
                        "org.springframework.cloud.commons.security.ResourceServerTokenRelayAutoConfiguration," +
                        "org.springframework.cloud.commons.config.CommonsConfigAutoConfiguration," +
                        "org.springframework.cloud.openfeign.hateoas.FeignHalAutoConfiguration," +
                        "org.springframework.cloud.openfeign.FeignAutoConfiguration," +
                        "org.springframework.cloud.openfeign.encoding.FeignAcceptGzipEncodingAutoConfiguration," +
                        "org.springframework.cloud.openfeign.encoding.FeignContentGzipEncodingAutoConfiguration," +
                        "org.springframework.cloud.openfeign.loadbalancer.FeignLoadBalancerAutoConfiguration"
        }
)
public class CucumberSpringConfiguration {
}
