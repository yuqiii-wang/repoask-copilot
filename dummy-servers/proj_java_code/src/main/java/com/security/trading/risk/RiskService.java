package com.security.trading.risk;

import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RiskService {
    
    private final ConcurrentHashMap<String, RiskAssessment> assessments = new ConcurrentHashMap<>();
    
    public RiskAssessment assessRisk(RiskAssessmentRequest request) {
        RiskAssessment assessment = new RiskAssessment();
        assessment.setAssessmentId("RISK-" + LocalDateTime.now().getYear() + "-" + String.format("%05d", assessments.size() + 1));
        assessment.setPortfolioId(request.getPortfolioId());
        assessment.setAssessmentTime(LocalDateTime.now());
        
        // Simulate VaR calculations
        assessment.setVar99(request.getPortfolioValue() * 0.05);
        assessment.setVar95(request.getPortfolioValue() * 0.03);
        assessment.setStressTestResult(request.getPortfolioValue() * 0.15);
        assessment.setCounterpartyRisk(request.getPortfolioValue() * 0.02);
        
        // Check if risk limits are breached
        if (assessment.getVar99() > request.getPortfolioValue() * 0.06) {
            assessment.setLimitBreached(true);
            assessment.setBreachReason("VaR 99% limit exceeded");
        } else {
            assessment.setLimitBreached(false);
        }
        
        // Store assessment
        assessments.put(assessment.getAssessmentId(), assessment);
        
        return assessment;
    }
    
    public RiskCheckResult checkRisk(RiskCheckRequest request) {
        RiskCheckResult result = new RiskCheckResult();
        result.setTradeId(request.getTradeId());
        
        // Simulate risk check
        double riskScore = request.getTradeValue() * 0.01 + Math.random() * 10;
        result.setRiskScore(riskScore);
        result.setCurrentPosition(request.getPositionSize());
        result.setMaxPositionLimit(1000000);
        
        if (riskScore < 50 && request.getPositionSize() < 1000000) {
            result.setApproved(true);
            result.setRiskStatus("APPROVED");
        } else {
            result.setApproved(false);
            result.setRiskStatus("REJECTED");
            result.setRejectionReason("Risk score too high or position limit exceeded");
        }
        
        return result;
    }
    
    public List<RiskAssessment> getAssessments() {
        return new ArrayList<>(assessments.values());
    }
    
    public RiskAssessment getAssessment(String assessmentId) {
        return assessments.get(assessmentId);
    }
}
