/**
 * 다단계 공격 체인 탐지기
 *
 * 세션 히스토리에 누적된 위협 카테고리들이 알려진 공격 체인 패턴과
 * 매칭되는지 검사한다. 개별 코드 블록은 mild-warn 수준이어도 누적되면
 * 공격임을 알 수 있는 케이스를 잡기 위한 레이어.
 *
 * [한계]
 * - 진짜 분할 공격(각 턴이 완전 무해해 보이는 조각)은 못 잡음.
 *   그 케이스는 capability tracking이 필요하며 별도 분석 모델이 요구됨.
 * - 현재는 카테고리 매칭 기반의 휴리스틱.
 */

const ATTACK_CHAINS = [
  {
    name: 'ransomware_chain',
    description: '랜섬웨어 공격 체인 — 파일 시스템 접근 + 암호화/난독화 + 외부 통신',
    requires: ['file_destruction'],
    plusAny: ['ransomware', 'obfuscation', 'data_exfiltration', 'network_access'],
    minPlusAny: 1,
  },
  {
    name: 'rce_chain',
    description: '원격 코드 실행 체인 — 네트워크 접근 + 코드 실행 + 권한 상승',
    requires: ['code_execution', 'network_access'],
    plusAny: ['privilege_escalation', 'reverse_shell'],
    minPlusAny: 0,
  },
  {
    name: 'exfiltration_chain',
    description: '데이터 유출 체인 — 데이터 접근 + 외부 전송 (난독화 동반 가능)',
    requires: ['data_exfiltration'],
    plusAny: ['obfuscation', 'network_access', 'code_execution'],
    minPlusAny: 1,
  },
  {
    name: 'backdoor_chain',
    description: '백도어 설치 체인 — 역방향 셸 + 권한 상승 + 영속화 코드',
    requires: ['reverse_shell'],
    plusAny: ['privilege_escalation', 'code_execution'],
    minPlusAny: 1,
  },
];

const BROAD_THREAT_THRESHOLD = 3;

/**
 * 세션 히스토리에서 공격 체인 탐지
 * @param {Array<{threatTypes: string[]}>} history
 * @returns {Object | null}
 */
function detectAttackChain(history) {
  if (!history || history.length < 2) return null;

  const seenTypes = new Set();
  for (const entry of history) {
    for (const t of entry.threatTypes) seenTypes.add(t);
  }
  if (seenTypes.size === 0) return null;

  const matchedPatterns = [];
  for (const pattern of ATTACK_CHAINS) {
    const hasAllRequired = pattern.requires.every((t) => seenTypes.has(t));
    if (!hasAllRequired) continue;

    const matchedOptional = pattern.plusAny.filter((t) => seenTypes.has(t));
    if (matchedOptional.length < pattern.minPlusAny) continue;

    matchedPatterns.push({
      name: pattern.name,
      description: pattern.description,
      matchedOptional,
    });
  }

  const broadPattern = seenTypes.size >= BROAD_THREAT_THRESHOLD;

  if (matchedPatterns.length === 0 && !broadPattern) return null;

  return {
    seenTypes: Array.from(seenTypes),
    matchedPatterns,
    broadPattern,
    historyLength: history.length,
  };
}

module.exports = { detectAttackChain, ATTACK_CHAINS };
