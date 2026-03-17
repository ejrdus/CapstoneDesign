/**
 * 위험도 판정 모듈 (Risk Classifier)
 * LLM 분석 결과를 기반으로 안전/주의/위험 3단계 분류
 */

const RISK_WEIGHTS = {
  file_destruction: 0.9,
  reverse_shell: 1.0,
  privilege_escalation: 0.85,
  data_exfiltration: 0.9,
  ransomware: 1.0,
  obfuscation: 0.7,
  network_access: 0.5,
  code_execution: 0.6,
};

/**
 * LLM 분석 결과를 바탕으로 최종 위험도 판정
 * @param {Object} llmResult - LLM 분석 JSON 결과
 * @returns {Object} { riskLevel, category, reason, details }
 */
function classifyRisk(llmResult) {
  const { threats = [], intent, confidence } = llmResult;

  if (threats.length === 0) {
    return {
      riskLevel: 'safe',
      category: '정상',
      reason: '악성 행위가 감지되지 않았습니다.',
      details: llmResult,
    };
  }

  // 각 위협의 가중치를 계산하여 최종 점수 산출
  let maxScore = 0;
  let primaryThreat = null;

  for (const threat of threats) {
    const weight = RISK_WEIGHTS[threat.type] || 0.5;
    const score = weight * (threat.severity || 0.5);

    if (score > maxScore) {
      maxScore = score;
      primaryThreat = threat;
    }
  }

  // 점수 기반 3단계 분류
  let riskLevel;
  if (maxScore >= 0.7) {
    riskLevel = 'danger';
  } else if (maxScore >= 0.4) {
    riskLevel = 'caution';
  } else {
    riskLevel = 'safe';
  }

  return {
    riskLevel,
    category: primaryThreat?.category || '알 수 없음',
    reason: primaryThreat?.description || '세부 정보 없음',
    details: llmResult,
  };
}

module.exports = { classifyRisk };
