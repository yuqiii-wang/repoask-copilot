package com.security.trading.risk;

import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/risk")
public class RiskController {
    
    private final RiskService riskService;
    
    public RiskController(RiskService riskService) {
        this.riskService = riskService;
    }
    
    @PostMapping("/assess")
    public RiskAssessment assessRisk(@RequestBody RiskAssessmentRequest request) {
        return riskService.assessRisk(request);
    }
    
    @PostMapping("/check")
    public RiskCheckResult checkRisk(@RequestBody RiskCheckRequest request) {
        return riskService.checkRisk(request);
    }
    
    @GetMapping("/assessments")
    public List<RiskAssessment> getAssessments() {
        return riskService.getAssessments();
    }
    
    @GetMapping("/assessments/{assessmentId}")
    public RiskAssessment getAssessment(@PathVariable String assessmentId) {
        return riskService.getAssessment(assessmentId);
    }
}
