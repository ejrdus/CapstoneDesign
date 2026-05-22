/**
 * Background Service Worker
 * Content Script와 백엔드 서버 사이의 통신을 중계
 *
 * [개선사항]
 * - 분석 결과 캐시 실제 구현 (동일 코드 중복 분석 방지 → 블러 시간 단축)
 * - 클라이언트 측 비식별화 + 매핑 저장 → 분석 결과 복원(de-anonymization) 지원
 *   매핑은 서버로 전송되지 않으며, 이 service-worker 메모리에만 보관된다.
 */

import { anonymize, deanonymizeResult, normalizeCode } from '../utils/anonymizer.js';

const SERVER_URL = 'http://localhost:3000';

// ─── 분석 결과 캐시 ─────────────────────────────────────────

const analysisCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10분

// ─── 비식별화 매핑 저장소 (blockId → { mapping, timestamp }) ──
const blockMappings = new Map();
const MAPPING_TTL = 10 * 60 * 1000; // 10분
const MAPPING_MAX_SIZE = 200;

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return String(hash);
}

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

function setCachedResult(code, result) {
  const key = hashCode(code);
  analysisCache.set(key, { result, timestamp: Date.now() });
  if (analysisCache.size > 100) {
    const firstKey = analysisCache.keys().next().value;
    analysisCache.delete(firstKey);
  }
}

function storeMapping(blockId, mapping) {
  if (!mapping || mapping.length === 0) return;
  blockMappings.set(blockId, { mapping, timestamp: Date.now() });
  // LRU 단순 구현 — 오래된 항목 제거
  if (blockMappings.size > MAPPING_MAX_SIZE) {
    const firstKey = blockMappings.keys().next().value;
    blockMappings.delete(firstKey);
  }
}

function getMapping(blockId) {
  const entry = blockMappings.get(blockId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > MAPPING_TTL) {
    blockMappings.delete(blockId);
    return null;
  }
  return entry.mapping;
}

// ─── 메시지 핸들러 ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_CODE') {
    handleAnalyzeCode(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'DEANONYMIZE_RESULT') {
    const { blockId, result } = message.payload || {};
    const mapping = getMapping(blockId);
    if (!mapping) {
      sendResponse({ restored: false, result });
      return false;
    }
    const restored = deanonymizeResult(result, mapping);
    sendResponse({ restored: true, result: restored, redactionCount: mapping.length });
    return false;
  }

  if (message.type === 'HAS_MAPPING') {
    const mapping = getMapping(message.payload?.blockId);
    sendResponse({ hasMapping: Boolean(mapping), count: mapping ? mapping.length : 0 });
    return false;
  }

  if (message.type === 'UPDATE_STATUS') {
    chrome.storage.local.get('analysisHistory', (data) => {
      const history = data.analysisHistory || [];
      history.unshift({ ...message.payload, timestamp: Date.now() });
      chrome.storage.local.set({
        analysisHistory: history.slice(0, 50),
      });
    });
  }
});

// ─── 분석 요청 처리 ─────────────────────────────────────────

/**
 * 백엔드 서버에 코드 분석 요청
 *
 * 흐름:
 *   1) 클라이언트에서 사전 비식별화 → 매핑은 메모리에 저장(서버 전송 X)
 *   2) 비식별화된 코드로 캐시 조회
 *   3) 캐시 미스면 서버에 비식별화된 코드 전송 (서버측 anonymizer가 backstop)
 *   4) 응답 캐시 + blockId/aiService 부가
 */
async function handleAnalyzeCode({ code, language, blockId, aiService }) {
  // 1. 클라이언트 비식별화 + 정규화 + 매핑 저장
  //    정규화는 캐시 적중률 향상용 — 서버측 preprocessCode와 동일 규칙
  const { anonymized, mapping } = anonymize(code);
  const normalized = normalizeCode(anonymized);
  storeMapping(blockId, mapping);

  // 2. 캐시 확인 (정규화된 비식별화 코드 기준)
  const cached = getCachedResult(normalized);
  if (cached) {
    console.log(`[AI Script Monitor] 캐시 히트 (blockId: ${blockId}, redactions: ${mapping.length})`);
    return { ...cached, blockId, aiService, fromCache: true, redactionCount: mapping.length };
  }

  // 3. 서버 요청 — 비식별화된 코드만 전송
  try {
    const response = await fetch(`${SERVER_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: normalized, language, aiService }),
    });

    if (!response.ok) {
      throw new Error(`서버 응답 오류: ${response.status}`);
    }

    const result = await response.json();
    setCachedResult(normalized, result);
    return { ...result, blockId, aiService, redactionCount: mapping.length };
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
