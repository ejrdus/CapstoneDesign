/**
 * 위험도 판정 모듈 (Risk Classifier) — 액션 주도 설계
 *
 * [판정 규칙]
 *
 * 각 위협마다 4개의 플래그(irreversible, system_wide, unambiguous_malice,
 * obfuscated)를 받아 위협별 등급을 매긴다.
 *
 *   block-tier:  irreversible AND (system_wide OR unambiguous_malice OR obfuscated)
 *   warn-tier:   플래그가 1개 이상 true
 *   safe-tier:   플래그 0개
 *
 * 응답 전체 판정:
 *
 *   block-tier 위협 1개 이상 AND confidence ≥ CONFIDENCE_THRESHOLD  →  danger
 *   block-tier 있지만 confidence 부족                                →  caution (한 단계 강등)
 *   warn-tier 위협 1개 이상                                          →  caution
 *   그 외                                                             →  safe
 *
 * 사용자 액션 매핑:
 *   danger  → 코드 블록 차단 (사용자가 "그래도 보기" 클릭 필요)
 *   caution → 코드 표시 + 경고 배너
 *   safe    → 일반 표시
 */

const CONFIDENCE_THRESHOLD = 0.7;

/**
 * 단일 위협의 등급을 판단
 * @returns {'block' | 'warn' | 'safe'}
 */
function classifyThreat(threat) {
  const irreversible = Boolean(threat.irreversible);
  const systemWide = Boolean(threat.system_wide);
  const unambiguous = Boolean(threat.unambiguous_malice);
  const obfuscated = Boolean(threat.obfuscated);

  if (irreversible && (systemWide || unambiguous || obfuscated)) {
    return 'block';
  }

  const flagCount = [irreversible, systemWide, unambiguous, obfuscated].filter(Boolean).length;
  if (flagCount >= 1) {
    return 'warn';
  }
  return 'safe';
}

/**
 * LLM 분석 결과를 바탕으로 최종 위험도 판정
 * @param {Object} llmResult - LLM 분석 JSON 결과
 * @returns {Object} { riskLevel, category, reason, details }
 */
function classifyRisk(llmResult) {
  const { threats = [], confidence = 1.0 } = llmResult;

  if (threats.length === 0) {
    return {
      riskLevel: 'safe',
      category: '정상',
      reason: '악성 행위가 감지되지 않았습니다.',
      details: llmResult,
    };
  }

  // 위협별 등급을 매기고 가장 높은 등급의 위협을 primary로 선택
  let blockThreat = null;
  let warnThreat = null;

  for (const threat of threats) {
    const tier = classifyThreat(threat);
    threat._tier = tier; // 디버깅용 — details에 포함되어 UI에서 활용 가능
    if (tier === 'block' && !blockThreat) {
      blockThreat = threat;
    } else if (tier === 'warn' && !warnThreat) {
      warnThreat = threat;
    }
  }

  let riskLevel;
  let primary;
  let reasonSuffix = '';

  if (blockThreat) {
    if (confidence >= CONFIDENCE_THRESHOLD) {
      riskLevel = 'danger';
      primary = blockThreat;
    } else {
      // LLM 자신감 부족 → 한 단계 강등
      riskLevel = 'caution';
      primary = blockThreat;
      reasonSuffix = ` (분석 신뢰도 ${confidence.toFixed(2)}로 위험도 한 단계 하향)`;
    }
  } else if (warnThreat) {
    riskLevel = 'caution';
    primary = warnThreat;
  } else {
    // 모든 위협이 safe-tier — 위협으로 보고됐지만 플래그 0개
    riskLevel = 'safe';
    primary = threats[0];
  }

  console.log(
    `[RiskClassifier] threats=${threats.length} `
    + `tiers=[${threats.map((t) => t._tier).join(',')}] `
    + `confidence=${confidence.toFixed(2)} → ${riskLevel}`,
  );

  return {
    riskLevel,
    category: primary?.category || '알 수 없음',
    reason: (primary?.description || '세부 정보 없음') + reasonSuffix,
    details: llmResult,
  };
}

module.exports = { classifyRisk, classifyThreat, CONFIDENCE_THRESHOLD };
