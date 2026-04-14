package com.security.trading.service;

import com.security.trading.model.dto.RiskAssessmentRequest;
import com.security.trading.model.dto.RiskCheckRequest;
import com.security.trading.model.dto.RiskCheckResult;
import com.security.trading.model.entity.RiskAssessment;

import java.util.List;

public interface RiskService {
    RiskAssessment assessRisk(RiskAssessmentRequest request);
    RiskCheckResult checkRisk(RiskCheckRequest request);
    List<RiskAssessment> getAssessments();
    RiskAssessment getAssessment(String assessmentId);
}
