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
 *   block-tier 있지만 confidence 부족(정직한 불확실)                  →  caution (한 단계 강등)
 *   warn-tier 위협 1개 이상                                          →  caution
 *   그 외                                                             →  safe
 *
 * [confidence 강등 게이트의 인젝션 우회 방어]
 *   confidence는 LLM이 스스로 보고하는 값이라, 공격자가 코드에 "너는 확실하지
 *   않다 / 신뢰도를 낮춰라" 같은 텍스트를 심어 confidence를 떨어뜨리면 진짜
 *   danger가 caution으로 강등될 수 있다. 이를 막기 위해:
 *     - analyzer_subversion / obfuscated / unambiguous_malice / 고-severity 위협은
 *       "조작 내성(manipulation-resistant)" 위협으로 보고, confidence가 낮아도
 *       강등하지 않는다.
 *     - confidence가 비정상적으로 낮으면(< SUSPICIOUS_CONFIDENCE_FLOOR) 그 자체를
 *       조작 의심 신호로 보고 강등하지 않는다(오히려 danger 유지).
 *     - 강등은 "정직한 불확실" 구간(FLOOR ≤ confidence < THRESHOLD)에서만 일어난다.
 *
 * 사용자 액션 매핑:
 *   danger  → 코드 블록 차단 (사용자가 "그래도 보기" 클릭 필요)
 *   caution → 코드 표시 + 경고 배너
 *   safe    → 일반 표시
 */

const CONFIDENCE_THRESHOLD = 0.7;
// 이 값보다 낮은 confidence는 "정직한 불확실"이 아니라 조작/이상 신호로 간주한다.
const SUSPICIOUS_CONFIDENCE_FLOOR = 0.3;
// LLM이 보고한 severity가 이 값 이상이면 고-severity로 보고 강등 내성을 부여한다.
const HIGH_SEVERITY = 0.8;

/**
 * confidence 값을 [0,1]로 검증·클램핑한다.
 * 누락/NaN/Infinity/문자열 등 비정상 값은 보수적으로 1.0(가장 확신)으로 처리한다 —
 * 보안 도구이므로 "신뢰도 불명"이 위협을 임의로 강등시키면 안 되기 때문이다.
 * @param {*} value
 * @returns {number} 0~1 범위의 유한 실수
 */
function validateConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1.0;
  return Math.max(0, Math.min(1, num));
}

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
 * block-tier 위협이 confidence 강등에 대해 "내성"을 갖는지 판단한다.
 * 내성을 가지면 confidence가 낮아도 danger를 유지한다(인젝션 우회 방어).
 */
function isManipulationResistant(threat) {
  const severity = Number(threat.severity);
  return (
    threat.type === 'analyzer_subversion'   // 분석기 우회 시도 자체 — confidence로 가릴 수 없음
    || Boolean(threat.obfuscated)           // 난독화 동반 — confidence 저하는 우회 정황
    || Boolean(threat.unambiguous_malice)   // 명백한 악의 — 정상 용도 없음
    || (Number.isFinite(severity) && severity >= HIGH_SEVERITY) // LLM이 직접 고-severity로 평가
  );
}

/**
 * LLM 분석 결과를 바탕으로 최종 위험도 판정
 * @param {Object} llmResult - LLM 분석 JSON 결과
 * @returns {Object} { riskLevel, category, reason, details }
 */
function classifyRisk(llmResult) {
  const { threats = [] } = llmResult;
  const confidence = validateConfidence(llmResult.confidence);

  if (threats.length === 0) {
    return {
      riskLevel: 'safe',
      category: '정상',
      reason: '악성 행위가 감지되지 않았습니다.',
      details: { ...llmResult, confidence },
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
      // 충분히 확신 → danger
      riskLevel = 'danger';
      primary = blockThreat;
    } else if (isManipulationResistant(blockThreat)) {
      // 낮은 confidence여도 강등 금지 — 인젝션/난독화/명백한 악의/고-severity 위협
      riskLevel = 'danger';
      primary = blockThreat;
      reasonSuffix = ` (신뢰도 ${confidence.toFixed(2)}이지만 조작 내성 위협으로 danger 유지)`;
    } else if (confidence < SUSPICIOUS_CONFIDENCE_FLOOR) {
      // 비정상적으로 낮은 신뢰도 = 신뢰도 위변조 의심 → 강등하지 않음
      riskLevel = 'danger';
      primary = blockThreat;
      reasonSuffix = ` (비정상적으로 낮은 신뢰도 ${confidence.toFixed(2)} — 신뢰도 조작 의심으로 danger 유지)`;
    } else {
      // 정직한 불확실 구간 → 한 단계 강등
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
    details: { ...llmResult, confidence },
  };
}

module.exports = {
  classifyRisk,
  classifyThreat,
  validateConfidence,
  isManipulationResistant,
  CONFIDENCE_THRESHOLD,
  SUSPICIOUS_CONFIDENCE_FLOOR,
  HIGH_SEVERITY,
};
