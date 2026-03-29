/**
 * 위험도 판정 모듈 (Risk Classifier)
 * LLM 분석 결과를 기반으로 안전/주의/위험 3단계 분류
 *
 * [점수 산출 방식]
 * - 주 점수: 가장 높은 위협의 (가중치 × severity)
 * - 복합 위협 보정: 위협이 2개 이상이면 누적 점수의 10%를 가산
 *   → 단독 위협보다 복합 위협이 더 위험하게 판정됨
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
  let totalScore = 0;
  let primaryThreat = null;

  for (const threat of threats) {
    const weight = RISK_WEIGHTS[threat.type] || 0.5;
    const score = weight * (threat.severity || 0.5);
    totalScore += score;

    if (score > maxScore) {
      maxScore = score;
      primaryThreat = threat;
    }
  }

  // 복합 위협 보정: 여러 위협이 동시에 존재하면 위험도 상향
  // 예: 네트워크 접근(0.5) + 코드 실행(0.6) 조합 → 개별로는 caution이지만 조합 시 danger
  let finalScore = maxScore;
  if (threats.length >= 2) {
    const otherScore = totalScore - maxScore;
    finalScore = Math.min(1.0, maxScore + otherScore * 0.1);
  }

  // 점수 기반 3단계 분류
  let riskLevel;
  if (finalScore >= 0.7) {
    riskLevel = 'danger';
  } else if (finalScore >= 0.4) {
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
