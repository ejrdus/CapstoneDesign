/**
 * riskClassifier 단위 테스트 — confidence 게이트 하드닝 검증 (LLM 호출 없음)
 *
 * 핵심 검증:
 *   - confidence 검증/클램핑 (NaN/누락/범위초과)
 *   - block 위협 + 충분한 confidence → danger
 *   - block 위협 + 정직한 불확실(FLOOR~THRESHOLD) → caution 강등
 *   - 조작 내성 위협(analyzer_subversion/obfuscated/unambiguous_malice/고-severity)은
 *     낮은 confidence여도 강등되지 않음 (인젝션 우회 방어)
 *   - 비정상적으로 낮은 confidence(<FLOOR)는 조작 의심 → 강등 안 함
 */

const {
  classifyRisk,
  validateConfidence,
  CONFIDENCE_THRESHOLD,
  SUSPICIOUS_CONFIDENCE_FLOOR,
} = require('../src/services/riskClassifier');

let pass = 0;
let fail = 0;
const failures = [];

function eq(name, actual, expected) {
  if (actual === expected) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name} — expected=${expected} actual=${actual}`);
    failures.push(name);
  }
}

// block-tier 위협 빌더: irreversible + system_wide = block (조작 내성 아님이 기본)
function blockThreat(extra = {}) {
  return {
    type: 'file_destruction',
    category: '파일 파괴',
    severity: 0.5,
    description: 'test',
    evidence: 'rm -rf /',
    lineHint: '1',
    irreversible: true,
    system_wide: true,
    unambiguous_malice: false,
    obfuscated: false,
    ...extra,
  };
}

console.log('=== riskClassifier 테스트 ===\n');

console.log('[1] validateConfidence 클램핑/검증');
eq('정상 0.5', validateConfidence(0.5), 0.5);
eq('범위 초과 1.5 → 1', validateConfidence(1.5), 1);
eq('음수 -0.3 → 0', validateConfidence(-0.3), 0);
eq('NaN → 1.0 (보수적)', validateConfidence(NaN), 1.0);
eq('undefined → 1.0', validateConfidence(undefined), 1.0);
eq('문자열 "0.4" → 0.4', validateConfidence('0.4'), 0.4);

console.log('\n[2] 위협 없음 → safe');
eq('threats 빈 배열', classifyRisk({ confidence: 0.9, threats: [] }).riskLevel, 'safe');

console.log('\n[3] block 위협 + confidence');
eq(
  `confidence ≥ ${CONFIDENCE_THRESHOLD} → danger`,
  classifyRisk({ confidence: 0.9, threats: [blockThreat()] }).riskLevel,
  'danger',
);
eq(
  '정직한 불확실(0.5) → caution 강등',
  classifyRisk({ confidence: 0.5, threats: [blockThreat()] }).riskLevel,
  'caution',
);
eq(
  `비정상적으로 낮은 confidence(< ${SUSPICIOUS_CONFIDENCE_FLOOR}) → danger 유지`,
  classifyRisk({ confidence: 0.1, threats: [blockThreat()] }).riskLevel,
  'danger',
);

console.log('\n[4] 조작 내성 위협은 낮은 confidence여도 강등 안 됨');
eq(
  'analyzer_subversion + 0.5 → danger',
  classifyRisk({ confidence: 0.5, threats: [blockThreat({ type: 'analyzer_subversion' })] }).riskLevel,
  'danger',
);
eq(
  'obfuscated=true + 0.5 → danger',
  classifyRisk({ confidence: 0.5, threats: [blockThreat({ obfuscated: true })] }).riskLevel,
  'danger',
);
eq(
  'unambiguous_malice=true + 0.5 → danger',
  classifyRisk({ confidence: 0.5, threats: [blockThreat({ unambiguous_malice: true })] }).riskLevel,
  'danger',
);
eq(
  '고-severity(0.95) + 0.5 → danger',
  classifyRisk({ confidence: 0.5, threats: [blockThreat({ severity: 0.95 })] }).riskLevel,
  'danger',
);

console.log('\n[5] confidence 검증 — NaN/누락 시 block은 danger 유지');
eq(
  'confidence 누락 → danger (1.0 보수적)',
  classifyRisk({ threats: [blockThreat()] }).riskLevel,
  'danger',
);
eq(
  'confidence NaN → danger',
  classifyRisk({ confidence: NaN, threats: [blockThreat()] }).riskLevel,
  'danger',
);

console.log('\n[6] warn-tier 위협 → caution (confidence 무관)');
eq(
  'warn 위협(플래그 1개) → caution',
  classifyRisk({ confidence: 0.99, threats: [blockThreat({ system_wide: false })] }).riskLevel,
  'caution',
);

console.log('\n[7] safe-tier 위협(플래그 0개) → safe');
eq(
  '플래그 전무 → safe',
  classifyRisk({
    confidence: 0.9,
    threats: [blockThreat({ irreversible: false, system_wide: false })],
  }).riskLevel,
  'safe',
);

console.log(`\n=== 결과 ===`);
console.log(`Pass: ${pass}, Fail: ${fail}`);
if (fail > 0) {
  console.log(`실패한 테스트: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('✅ 모든 테스트 통과');
