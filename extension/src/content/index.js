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

import { extractNewCodeBlocks, observeCodeBlocks, observeAssistantMessages, ensureMessageId } from './codeExtractor';

// AI 응답 메시지 셀렉터 (registerBlockForMessage의 안전망용)
const ASSISTANT_MSG_SELECTOR = '[data-message-author-role="assistant"], article[data-testid^="conversation-turn"]';
import { detectLanguage } from './languageDetector';
import { applyAnalysisResult, applyMessageBlur, removeMessageBlur, markMessageDanger } from './overlay';

// ─── 메시지 단위 블러 상태 관리 ───────────────────────────────
// AI 응답 메시지 전체에 블러를 입히고, 스트리밍이 끝나면(idle) 풀어준다.
const messageStates = new Map();
// blockId → msgId 역참조 (코드 블록 분석 결과로 메시지 위험도 갱신)
const blockToMessage = new Map();

const MESSAGE_IDLE_MS = 1500; // 메시지 스트리밍 idle 판정 시간

function handleNewMessage(msgId, msgEl) {
  applyMessageBlur(msgEl, msgId);
  messageStates.set(msgId, {
    element: msgEl,
    idleTimer: null,
    settled: false,
    pendingAnalyses: 0,
    completedAnalyses: 0,
    dangerCount: 0,
    revealed: false,
  });
  scheduleMessageIdle(msgId);
}

function handleMessageMutation(msgId) {
  const state = messageStates.get(msgId);
  if (!state || state.revealed) return;
  // 새 변경이 발생했으니 idle 타이머 리셋
  scheduleMessageIdle(msgId);
}

function scheduleMessageIdle(msgId) {
  const state = messageStates.get(msgId);
  if (!state) return;
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    state.settled = true;
    tryRevealMessage(msgId);
  }, MESSAGE_IDLE_MS);
}

function tryRevealMessage(msgId) {
  const state = messageStates.get(msgId);
  if (!state || state.revealed) return;
  // 스트리밍이 idle 상태여야 함
  if (!state.settled) return;
  // 진행 중인 코드 블록 분석이 있으면 대기
  if (state.pendingAnalyses > state.completedAnalyses) return;

  if (state.dangerCount > 0) {
    markMessageDanger(state.element, msgId, `${state.dangerCount}개의 위험한 코드 블록이 감지되었습니다.`);
  } else {
    removeMessageBlur(state.element, msgId);
  }
  state.revealed = true;
}

function registerBlockForMessage(blockId, element) {
  if (!element || !element.closest) return;

  // 1차: 이미 마킹된 메시지를 찾기
  let msgEl = element.closest('[data-asm-msg-id]');

  // 2차 안전망: 마킹되지 않았다면 원본 셀렉터로 직접 끌어와서 retroactive 블러
  // 단 historical로 마킹된 경우는 건드리지 않음
  if (!msgEl) {
    const candidate = element.closest(ASSISTANT_MSG_SELECTOR);
    if (candidate) {
      const existingState = candidate.getAttribute('data-asm-msg-state');
      if (existingState !== 'historical' && existingState !== 'revealed') {
        const id = ensureMessageId(candidate);
        if (id && !messageStates.has(id)) {
          console.log(`[AI Script Monitor] Retroactive 메시지 블러: ${id}`);
          handleNewMessage(id, candidate);
        }
        msgEl = candidate;
      }
    }
  }

  if (!msgEl) return;
  const msgId = msgEl.getAttribute('data-asm-msg-id');
  const msgState = messageStates.get(msgId);
  if (!msgState) return; // historical 등은 무시
  if (blockToMessage.has(blockId)) return;
  blockToMessage.set(blockId, msgId);
  msgState.pendingAnalyses += 1;
  // 새 코드 블록이 발견되면 idle 카운트도 다시 시작
  scheduleMessageIdle(msgId);
}

function notifyBlockAnalyzed(blockId, result) {
  const msgId = blockToMessage.get(blockId);
  if (!msgId) return;
  const msgState = messageStates.get(msgId);
  if (!msgState) return;
  msgState.completedAnalyses += 1;
  if (result && result.riskLevel === 'danger') {
    msgState.dangerCount += 1;
  }
  tryRevealMessage(msgId);
}

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
  // 너무 짧은 코드(스트리밍 시작 직후 등)는 분석 보류
  // — 블러는 이미 적용된 상태이고, 이후 content update가 들어오면 다시 스케줄됨
  if (!code || code.trim().length < 5) {
    return;
  }

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
    notifyBlockAnalyzed(blockId, response);

    // Popup에 상태 업데이트
    chrome.runtime.sendMessage({
      type: 'UPDATE_STATUS',
      payload: { ...response, language: detectedLang, blockId },
    });
  } catch (error) {
    console.error('[AI Script Monitor] 분석 오류:', error);
    const errorResult = {
      riskLevel: 'unknown',
      category: '통신 오류',
      reason: '서버 연결에 실패했습니다.',
    };
    applyAnalysisResult(blockId, errorResult);
    notifyBlockAnalyzed(blockId, errorResult);
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

// 1. Assistant 메시지 감지 — 새 메시지 전체에 블러 적용 (코드 블록 옵저버보다 먼저 등록)
observeAssistantMessages(handleNewMessage, handleMessageMutation);

// 2. 이미 페이지에 있는 코드 블록 스캔 (대화 히스토리 포함)
const initialBlocks = extractNewCodeBlocks();
initialBlocks.forEach((block) => {
  registerBlockForMessage(block.blockId, block.element);
  scheduleAnalysis(block.blockId, block.code, block.language, block.blurTarget, block.element);
});

// 3. 새 코드 블록 실시간 감시
observeCodeBlocks(
  // onNewBlock: 새 코드 블록 발견 시 (블러는 이미 적용된 상태)
  (block) => {
    registerBlockForMessage(block.blockId, block.element);
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

console.log('[AI Script Monitor] Content Script 로드 완료 (Message-Blur 모드)');
