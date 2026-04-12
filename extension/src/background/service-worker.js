/**
 * Background Service Worker
 * Content Script와 백엔드 서버 사이의 통신을 중계
 *
 * [개선사항]
 * - 분석 결과 캐시 실제 구현 (동일 코드 중복 분석 방지 → 블러 시간 단축)
 * - 캐시 TTL 관리 (10분 후 자동 만료)
 */

const SERVER_URL = 'http://localhost:3000';

// ─── 분석 결과 캐시 ─────────────────────────────────────────

const analysisCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10분

/**
 * 코드 해시를 캐시 키로 사용
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return String(hash);
}

/**
 * 캐시에서 결과 조회 (TTL 만료 시 null)
 */
function getCachedResult(code) {
  const key = hashCode(code);
  const cached = analysisCache.get(key);
  if (!cached) return null;

  if (Date.now() - cached.timestamp > CACHE_TTL) {
    analysisCache.delete(key);
    return null;
  }

  return cached.result;
}

/**
 * 결과를 캐시에 저장
 */
function setCachedResult(code, result) {
  const key = hashCode(code);
  analysisCache.set(key, { result, timestamp: Date.now() });

  // 캐시 크기 제한 (최대 100개)
  if (analysisCache.size > 100) {
    const firstKey = analysisCache.keys().next().value;
    analysisCache.delete(firstKey);
  }
}

// ─── 메시지 핸들러 ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_CODE') {
    handleAnalyzeCode(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // 비동기 응답을 위해 true 반환
  }

  if (message.type === 'UPDATE_STATUS') {
    // 최근 분석 결과를 storage에 저장 (Popup에서 읽기 위해)
    chrome.storage.local.get('analysisHistory', (data) => {
      const history = data.analysisHistory || [];
      history.unshift({ ...message.payload, timestamp: Date.now() });
      chrome.storage.local.set({
        analysisHistory: history.slice(0, 50), // 최근 50개만 유지
      });
    });
  }
});

// ─── 분석 요청 처리 ─────────────────────────────────────────

/**
 * 백엔드 서버에 코드 분석 요청
 * 캐시에 결과가 있으면 즉시 반환 (블러 해제 시간 최소화)
 */
async function handleAnalyzeCode({ code, language, blockId, aiService }) {
  // 1. 캐시 확인 — 히트하면 서버 요청 없이 즉시 응답
  const cached = getCachedResult(code);
  if (cached) {
    console.log(`[AI Script Monitor] 캐시 히트 (blockId: ${blockId})`);
    return { ...cached, blockId, aiService, fromCache: true };
  }

  // 2. 서버 요청
  try {
    const response = await fetch(`${SERVER_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language, aiService }),
    });

    if (!response.ok) {
      throw new Error(`서버 응답 오류: ${response.status}`);
    }

    const result = await response.json();

    // 3. 결과 캐시
    setCachedResult(code, result);

    return { ...result, blockId, aiService };
  } catch (error) {
    console.error('[AI Script Monitor] 서버 통신 오류:', error);
    return {
      riskLevel: 'unknown',
      category: 'error',
      reason: '서버 연결 실패',
      blockId,
    };
  }
}
