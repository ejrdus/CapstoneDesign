/**
 * Content Script 진입점
 *
 * [Blur-First, Analyze-Later 전략]
 *
 * 1. 코드 블록 감지 → 즉시 블러 적용 (codeExtractor에서 처리)
 * 2. 스트리밍 완료 대기 → debounce로 코드 안정화 감지
 * 3. 안정화된 코드를 서버로 분석 요청
 * 4. 결과에 따라 블러 해제 / 경고 / 차단
 */

import { extractNewCodeBlocks, observeCodeBlocks } from './codeExtractor';
import { detectLanguage } from './languageDetector';
import { applyAnalysisResult } from './overlay';

// 블록별 debounce 타이머 관리
const debounceTimers = new Map();
// 블록별 최신 코드 내용 추적 (스트리밍 중 업데이트됨)
const latestCodeMap = new Map();
// 이미 분석 요청을 보낸 코드 해시 (중복 방지)
const analyzedHashes = new Set();

const DEBOUNCE_MS = 800; // 스트리밍 안정화 대기 시간

/**
 * 코드 블록에 대해 debounce 적용 후 분석 요청
 * 스트리밍 중에는 타이머가 계속 리셋되다가, 코드가 안정화되면 분석 실행
 */
function scheduleAnalysis(blockId, code, language, blurTarget, element) {
  // 최신 코드 저장
  latestCodeMap.set(blockId, { code, language, blurTarget, element });

  // 기존 타이머 리셋
  if (debounceTimers.has(blockId)) {
    clearTimeout(debounceTimers.get(blockId));
  }

  // 새 타이머 설정
  const timer = setTimeout(() => {
    debounceTimers.delete(blockId);
    const latest = latestCodeMap.get(blockId);
    if (latest) {
      executeAnalysis(blockId, latest.code, latest.language);
    }
  }, DEBOUNCE_MS);

  debounceTimers.set(blockId, timer);
}

/**
 * 서버에 분석 요청 실행
 */
async function executeAnalysis(blockId, code, language) {
  const codeHash = hashCode(code);

  // 동일 코드 중복 분석 방지
  if (analyzedHashes.has(codeHash)) return;
  analyzedHashes.add(codeHash);

  const detectedLang = language !== 'unknown' ? language : detectLanguage(code);

  try {
    // Background Script를 통해 서버에 분석 요청
    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_CODE',
      payload: {
        code,
        language: detectedLang,
        blockId,
      },
    });

    if (response && response.error) {
      console.error('[AI Script Monitor] 분석 오류:', response.error);
      // 에러 시 블러 해제 (사용성 우선)
      applyAnalysisResult(blockId, {
        riskLevel: 'unknown',
        category: '분석 오류',
        reason: response.error,
      });
      return;
    }

    // 분석 결과를 오버레이에 반영
    applyAnalysisResult(blockId, response);

    // Popup에 상태 업데이트
    chrome.runtime.sendMessage({
      type: 'UPDATE_STATUS',
      payload: { ...response, language: detectedLang, blockId },
    });
  } catch (error) {
    console.error('[AI Script Monitor] 분석 오류:', error);
    applyAnalysisResult(blockId, {
      riskLevel: 'unknown',
      category: '통신 오류',
      reason: '서버 연결에 실패했습니다.',
    });
  }
}

/**
 * 간단한 문자열 해시
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

// ─── 초기화 ──────────────────────────────────────────────────

// 1. 이미 페이지에 있는 코드 블록 스캔 (블러는 extractNewCodeBlocks 내부에서 즉시 적용)
const initialBlocks = extractNewCodeBlocks();
initialBlocks.forEach((block) => {
  scheduleAnalysis(block.blockId, block.code, block.language, block.blurTarget, block.element);
});

// 2. 새 코드 블록 실시간 감시
observeCodeBlocks(
  // onNewBlock: 새 코드 블록 발견 시 (블러는 이미 적용된 상태)
  (block) => {
    scheduleAnalysis(block.blockId, block.code, block.language, block.blurTarget, block.element);
  },
  // onContentUpdate: 스트리밍 중 기존 블록의 내용이 변경될 때
  (blockId, newCode, element) => {
    const existing = latestCodeMap.get(blockId);
    if (existing) {
      // debounce 타이머 리셋 — 코드가 아직 스트리밍 중이므로 분석 지연
      scheduleAnalysis(blockId, newCode, existing.language, existing.blurTarget, element);
    }
  }
);

console.log('[AI Script Monitor] Content Script 로드 완료 (Blur-First 모드)');
