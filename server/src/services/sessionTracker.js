/**
 * 세션 단위 위협 누적 추적기
 *
 * 한 대화창에서 여러 코드 블록이 순차적으로 생성될 때, 각각은 개별적으로
 * 무해해 보이지만 누적되면 공격 체인을 이룰 수 있다. 이 모듈은 세션 단위로
 * 최근 위협 유형들을 기록하여 multiStageDetector가 패턴 매칭에 사용한다.
 *
 * [세션 식별]
 * - 1순위: 확장 프로그램이 전달하는 conversationId(sessionId) — 대화창 단위로 정확.
 *   NAT/프록시 환경에서 IP가 공유돼도 사용자별로 분리된다.
 * - 2순위(fallback): IP + aiService — sessionId가 없을 때만 사용(정밀하지 못함,
 *   NAT 환경에서 충돌 가능).
 *
 * [현재 구현의 한계]
 * - 메모리 저장 (서버 재시작 시 휘발)
 *   → 다중 인스턴스/HA 배포 시엔 Redis 등 외부 저장소 권장
 */

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY = 20;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const sessions = new Map();

function makeKey(sessionId, ip, aiService) {
  // conversationId(sessionId)가 있으면 그것만으로 키를 만든다 (IP 무관 → NAT 안전)
  if (sessionId) return `sid::${sessionId}`;
  return `ip::${ip || 'unknown'}::${aiService || 'unknown'}`;
}

/**
 * 분석 결과를 세션 히스토리에 기록
 */
function recordAnalysis(sessionId, ip, aiService, result) {
  const key = makeKey(sessionId, ip, aiService);
  const now = Date.now();
  let entry = sessions.get(key);

  if (!entry || now - entry.lastSeen > SESSION_TTL_MS) {
    entry = { history: [], lastSeen: now };
    sessions.set(key, entry);
  }

  entry.lastSeen = now;
  entry.history.push({
    timestamp: now,
    riskLevel: result.riskLevel,
    threatTypes: (result.details?.threats || []).map((t) => t.type),
  });

  if (entry.history.length > MAX_HISTORY) {
    entry.history.shift();
  }
}

/**
 * 현재 세션의 위협 히스토리 조회
 * @returns {Array<{timestamp, riskLevel, threatTypes}> | null}
 */
function getSessionHistory(sessionId, ip, aiService) {
  const key = makeKey(sessionId, ip, aiService);
  const entry = sessions.get(key);
  if (!entry) return null;

  if (Date.now() - entry.lastSeen > SESSION_TTL_MS) {
    sessions.delete(key);
    return null;
  }

  return entry.history;
}

// 만료된 세션 주기적 정리 (메모리 누수 방지)
// unref(): 이 타이머가 프로세스 종료를 막지 않도록 (스크립트에서 require해도 정상 종료)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sessions.entries()) {
    if (now - entry.lastSeen > SESSION_TTL_MS) {
      sessions.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

module.exports = { recordAnalysis, getSessionHistory };
