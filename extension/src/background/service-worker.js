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
import { getServerUrl } from '../utils/api.js';

const DEFAULT_SERVER_URL = 'http://localhost:3000';
const REQUEST_TIMEOUT_MS = 15000; // 서버가 멈춰도 무한 대기하지 않도록 분석 요청 타임아웃

// 분석 요청에 사용할 서버 설정(URL + 선택적 API 키)을 chrome.storage에서 읽는다.
// 하드코딩 대신 설정 가능하게 하여 스테이징/프로덕션 배포를 지원.
async function getRequestConfig() {
  let serverUrl = DEFAULT_SERVER_URL;
  try {
    serverUrl = await getServerUrl();
  } catch (e) {
    serverUrl = DEFAULT_SERVER_URL;
  }
  let apiKey = null;
  try {
    const data = await chrome.storage.local.get('apiKey');
    apiKey = data.apiKey || null;
  } catch (e) {
    apiKey = null;
  }
  return { serverUrl: serverUrl || DEFAULT_SERVER_URL, apiKey };
}

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
async function handleAnalyzeCode({ code, language, blockId, aiService, sessionId }) {
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

  // 3. 서버 요청 — 비식별화된 코드만 전송 (타임아웃 + 에러 타입 구분)
  const { serverUrl, apiKey } = await getRequestConfig();
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${serverUrl}/api/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: normalized, language, aiService, sessionId }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = new Error(`서버 응답 오류: ${response.status}`);
      err.errorType = response.status >= 500 ? 'server_error' : 'bad_request';
      throw err;
    }

    let result;
    try {
      result = await response.json();
    } catch (e) {
      const err = new Error('서버 응답 JSON 파싱 실패');
      err.errorType = 'invalid_response';
      throw err;
    }

    // 서버 응답이 기대한 형태인지 최소 검증
    if (!result || typeof result.riskLevel !== 'string') {
      const err = new Error('서버 응답 형식 오류 (riskLevel 누락)');
      err.errorType = 'invalid_response';
      throw err;
    }

    setCachedResult(normalized, result);
    return { ...result, blockId, aiService, redactionCount: mapping.length };
  } catch (error) {
    const errorType = error.name === 'AbortError' ? 'timeout' : (error.errorType || 'network');
    const reasonMap = {
      timeout: '서버 응답 시간 초과',
      server_error: '서버 내부 오류',
      bad_request: '잘못된 분석 요청',
      invalid_response: '서버 응답 형식 오류',
      network: '서버 연결 실패',
    };
    console.error(`[AI Script Monitor] 서버 통신 오류 (${errorType}):`, error.message);
    return {
      riskLevel: 'unknown',
      category: 'error',
      errorType,
      reason: reasonMap[errorType] || '서버 연결 실패',
      blockId,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
