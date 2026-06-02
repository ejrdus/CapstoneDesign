/**
 * Content Script 진입점
 *
 * [Blur-First, Analyze-Later 전략]
 *
 * 1. 코드 블록 감지 -> 즉시 블러 적용 (codeExtractor에서 처리)
 * 2. 스트리밍 완료 대기 -> idle 타이머로 스트리밍 종료 감지
 * 3. 스트리밍 종료 후 코드를 다시 읽어 서버로 분석 요청
 * 4. 결과에 따라 블러 해제 / 경고 / 차단
 */

import { extractNewCodeBlocks, observeCodeBlocks, observeAssistantMessages, ensureMessageId, extractCleanText } from './codeExtractor';

const ASSISTANT_MSG_SELECTOR = [
  '[data-message-author-role="assistant"]',
  'article[data-testid^="conversation-turn"]',
  '[data-testid="chat-message-model"]',
  '.font-claude-message',
  'model-response',
  'message-content[data-content-type="model"]',
  '.model-response-text',
  '.response-container-content',
].join(', ');
import { detectLanguage } from './languageDetector';
import { applyAnalysisResult, applyMessageBlur, removeMessageBlur, markMessageDanger } from './overlay';
import { detectAIService } from '../utils/constants';

const currentAIService = detectAIService();

// 대화창(세션) 식별자 — 서버의 다단계 공격 체인 탐지가 IP 대신 이 값으로 세션을
// 구분한다(NAT/프록시 환경에서 IP 공유로 인한 세션 충돌 방지). 페이지 로드 단위 UUID.
const conversationId = (self.crypto && self.crypto.randomUUID)
  ? self.crypto.randomUUID()
  : `conv-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

// ─── 메시지 단위 블러 상태 관리 ───────────────────────────────
const messageStates = new Map();
const blockToMessage = new Map();
const MESSAGE_IDLE_MS = 3000;

function handleNewMessage(msgId, msgEl) {
  console.log('[ASM-DEBUG] handleNewMessage:', msgId);
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
  state.settled = false;
  scheduleMessageIdle(msgId);
}

function scheduleMessageIdle(msgId) {
  const state = messageStates.get(msgId);
  if (!state) return;
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    state.settled = true;
    console.log('[ASM-DEBUG] idle 타이머 발동:', msgId);
    // 스트리밍 완료 — live DOM에서 코드 블록을 다시 스캔해서 분석
    const analysisStarted = rescanMessageBlocks(msgId);
    if (!analysisStarted) {
      // 분석할 코드 블록이 없으면 바로 블러 해제
      tryRevealMessage(msgId, true);
    }
    // 분석이 시작됐으면 notifyBlockAnalyzed에서 블러 해제됨
  }, MESSAGE_IDLE_MS);
}

/**
 * 스트리밍 종료 후, live DOM에서 메시지를 다시 찾아 코드 블록을 분석.
 * ChatGPT의 React re-render로 인해 저장된 element 참조가 무효화될 수 있으므로
 * document.querySelector로 현재 DOM에서 직접 검색한다.
 */
/**
 * 스트리밍 종료 후, live DOM에서 메시지를 다시 찾아 코드 블록을 분석.
 * @returns {boolean} 분석이 시작되었으면 true, 아니면 false
 */
function rescanMessageBlocks(msgId) {
  // live DOM에서 메시지 요소를 직접 검색
  const liveMsg = document.querySelector(`[data-asm-msg-id="${msgId}"]`);
  console.log('[ASM-DEBUG] rescan 시작:', msgId, 'liveMsg=' + !!liveMsg);
  if (!liveMsg) return false;

  // 메시지 내 모든 pre, code 요소를 탐색
  const codeElements = liveMsg.querySelectorAll('pre, code');
  console.log('[ASM-DEBUG] rescan 요소 수:', codeElements.length);

  // <pre><code> 중복 방지: <pre> 안의 <code>는 스킵 (같은 텍스트 2번 분석 방지)
  const analyzedTexts = new Set();
  let analysisStarted = false;

  for (const el of codeElements) {
    // 우리 확장의 배너/오버레이 내부 요소는 스킵
    if (el.closest && el.closest('[data-asm-banner], [data-asm-msg-banner], .asm-result-banner')) continue;

    // <code>가 <pre> 안에 있으면 <pre>에서 이미 처리되므로 스킵
    if (el.tagName === 'CODE' && el.parentElement && el.parentElement.tagName === 'PRE') continue;

    // 이미 제대로 분석된 블록은 스킵
    const existingId = el.getAttribute('data-asm-id');
    if (existingId && properlyAnalyzed.has(existingId)) continue;

    // textContent로 실제 코드 읽기
    const code = (el.textContent || '').trim();
    if (code.length < 10) continue; // 짧은 헤더/라벨 무시

    // 같은 메시지 내 동일 텍스트 중복 분석 방지
    const codeHash = hashCode(code);
    if (analyzedTexts.has(codeHash)) continue;
    analyzedTexts.add(codeHash);

    console.log('[ASM-DEBUG] rescan 분석 대상 발견:', code.length, 'chars');

    // blockId 부여 (없으면 생성)
    let blockId = existingId;
    if (!blockId) {
      blockId = 'asm-rescan-' + Date.now() + '-' + analyzedTexts.size;
      el.setAttribute('data-asm-id', blockId);
    }

    // 블록을 메시지에 등록 → 분석 완료 시 notifyBlockAnalyzed가 블러 해제
    const msgState = messageStates.get(msgId);
    if (msgState && !blockToMessage.has(blockId)) {
      blockToMessage.set(blockId, msgId);
      msgState.pendingAnalyses += 1;
    }

    const lang = detectLanguageFromElement(el);
    executeAnalysis(blockId, code, lang);
    analysisStarted = true;
  }

  if (!analysisStarted) {
    console.log('[ASM-DEBUG] rescan: 분석할 코드 블록 없음');
  }
  return analysisStarted;
}

function detectLanguageFromElement(el) {
  const cls = el.className || '';
  const m = cls.match(/language-(\w+)/);
  if (m) return m[1];
  const codeChild = el.querySelector && el.querySelector('code[class*="language-"]');
  if (codeChild) {
    const m2 = (codeChild.className || '').match(/language-(\w+)/);
    if (m2) return m2[1];
  }
  return 'unknown';
}

function tryRevealMessage(msgId, force) {
  const state = messageStates.get(msgId);
  if (!state || state.revealed) return;
  if (!state.settled) return;
  if (!force && state.pendingAnalyses > state.completedAnalyses) return;

  console.log('[ASM-DEBUG] tryReveal:', msgId, '→ REVEALING! danger=' + state.dangerCount);

  if (state.dangerCount > 0) {
    markMessageDanger(state.element, msgId, `${state.dangerCount}개의 위험한 코드 블록이 감지되었습니다.`);
  } else {
    removeMessageBlur(state.element, msgId);
  }
  state.revealed = true;
}

function registerBlockForMessage(blockId, element) {
  if (!element || !element.closest) return;
  let msgEl = element.closest('[data-asm-msg-id]');
  if (!msgEl) {
    const candidate = element.closest(ASSISTANT_MSG_SELECTOR);
    if (candidate) {
      const existingState = candidate.getAttribute('data-asm-msg-state');
      if (existingState !== 'historical' && existingState !== 'revealed') {
        const id = ensureMessageId(candidate);
        if (id && !messageStates.has(id)) {
          handleNewMessage(id, candidate);
        }
        msgEl = candidate;
      }
    }
  }
  if (!msgEl) return;
  const msgId = msgEl.getAttribute('data-asm-msg-id');
  const msgState = messageStates.get(msgId);
  if (!msgState) return;
  if (blockToMessage.has(blockId)) return;
  blockToMessage.set(blockId, msgId);
  msgState.pendingAnalyses += 1;
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
  // 모든 분석이 완료되었으면 블러 해제
  if (msgState.settled && msgState.completedAnalyses >= msgState.pendingAnalyses) {
    tryRevealMessage(msgId, true);
  }
}

// ─── 분석 상태 관리 ──────────────────────────────────────────
const debounceTimers = new Map();
const latestCodeMap = new Map();
const analyzedHashes = new Set();
const lockedBlocks = new Set();
// 서버/캐시로 제대로 분석 완료된 블록 (rescan에서 스킵용)
const properlyAnalyzed = new Set();

const DEBOUNCE_MS = 800;

// ─── 영구 차단 블록리스트 (danger 판정 코드 영구 저장) ────────
const BLOCKLIST_KEY = 'asm-blocklist';

async function getBlocklist() {
  return new Promise((resolve) => {
    chrome.storage.local.get(BLOCKLIST_KEY, (data) => {
      resolve(data[BLOCKLIST_KEY] || {});
    });
  });
}

function addToBlocklist(codeHash, result) {
  chrome.storage.local.get(BLOCKLIST_KEY, (data) => {
    const blocklist = data[BLOCKLIST_KEY] || {};
    blocklist[codeHash] = {
      riskLevel: result.riskLevel,
      category: result.category,
      reason: result.reason,
      details: result.details,
      blockedAt: Date.now(),
    };
    chrome.storage.local.set({ [BLOCKLIST_KEY]: blocklist });
  });
}

// ─── 분석 결과 캐싱 ─────────────────────────────────────────
const CACHE_PREFIX = 'asm-cache-';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function getCachedResult(codeHash) {
  return new Promise((resolve) => {
    const key = `${CACHE_PREFIX}${codeHash}`;
    chrome.storage.local.get(key, (data) => {
      const cached = data[key];
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        resolve(cached.result);
      } else {
        resolve(null);
      }
    });
  });
}

function setCachedResult(codeHash, result) {
  const key = `${CACHE_PREFIX}${codeHash}`;
  chrome.storage.local.set({ [key]: { result, timestamp: Date.now() } });
}

function isLockedVerdict(level) {
  return level === 'safe' || level === 'caution' || level === 'danger';
}

function sendUpdateStatus(result, detectedLang, blockId) {
  console.log('[ASM-DEBUG] UPDATE_STATUS 전송:', blockId, 'risk=' + result.riskLevel);
  try {
    chrome.runtime.sendMessage({
      type: 'UPDATE_STATUS',
      payload: { ...result, language: detectedLang, blockId, aiService: currentAIService },
    });
  } catch (e) {
    console.error('[ASM-DEBUG] UPDATE_STATUS 실패:', e);
  }
}

function scheduleAnalysis(blockId, code, language, blurTarget, element) {
  if (lockedBlocks.has(blockId)) return;
  latestCodeMap.set(blockId, { code, language, blurTarget, element });
  if (debounceTimers.has(blockId)) {
    clearTimeout(debounceTimers.get(blockId));
  }
  const timer = setTimeout(() => {
    debounceTimers.delete(blockId);
    const latest = latestCodeMap.get(blockId);
    if (latest) {
      executeAnalysis(blockId, latest.code, latest.language);
    }
  }, DEBOUNCE_MS);
  debounceTimers.set(blockId, timer);
}

async function executeAnalysis(blockId, code, language) {
  if (lockedBlocks.has(blockId)) return;

  // 너무 짧은 코드 — 스트리밍 중일 수 있음. 블러 해제하되 잠그지 않음 (나중에 내용이 채워지면 재분석)
  if (!code || code.trim().length < 5) {
    console.log('[ASM-DEBUG] executeAnalysis 짧은 코드 스킵:', blockId, 'len=' + (code ? code.trim().length : 0));
    applyAnalysisResult(blockId, { riskLevel: 'safe', _noBanner: true });
    notifyBlockAnalyzed(blockId, { riskLevel: 'safe' });
    return;
  }

  const codeHash = hashCode(code);
  const detectedLang = language !== 'unknown' ? language : detectLanguage(code);

  console.log('[ASM-DEBUG] executeAnalysis 분석 시작:', blockId, 'len=' + code.trim().length, 'hash=' + codeHash);

  // 영구 차단 블록리스트 확인 (danger 판정된 코드는 영구 차단)
  const blocklist = await getBlocklist();
  if (blocklist[codeHash]) {
    console.log('[ASM-DEBUG] 블록리스트 히트 (영구 차단):', blockId);
    const blockedResult = blocklist[codeHash];
    lockedBlocks.add(blockId);
    properlyAnalyzed.add(blockId);
    analyzedHashes.add(codeHash);
    applyAnalysisResult(blockId, blockedResult);
    notifyBlockAnalyzed(blockId, blockedResult);
    sendUpdateStatus(blockedResult, detectedLang, blockId);
    return;
  }

  // 동일 코드 중복 분석 방지
  if (analyzedHashes.has(codeHash)) {
    console.log('[ASM-DEBUG] 중복 해시 스킵:', blockId);
    lockedBlocks.add(blockId);
    properlyAnalyzed.add(blockId);
    applyAnalysisResult(blockId, { riskLevel: 'safe', _noBanner: true });
    notifyBlockAnalyzed(blockId, { riskLevel: 'safe' });
    return;
  }
  analyzedHashes.add(codeHash);

  // 캐시 확인
  const cached = await getCachedResult(codeHash);
  if (cached) {
    console.log('[ASM-DEBUG] 캐시 히트:', blockId, 'risk=' + cached.riskLevel);
    if (isLockedVerdict(cached.riskLevel)) lockedBlocks.add(blockId);
    properlyAnalyzed.add(blockId);
    applyAnalysisResult(blockId, cached);
    notifyBlockAnalyzed(blockId, cached);
    sendUpdateStatus(cached, detectedLang, blockId);

    return;
  }

  // 서버 분석
  try {
    console.log('[ASM-DEBUG] 서버 분석 요청:', blockId);
    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_CODE',
      payload: { code, language: detectedLang, blockId, aiService: currentAIService, sessionId: conversationId },
    });

    if (response && response.error) {
      console.error('[AI Script Monitor] 분석 오류:', response.error);
      const errResult = { riskLevel: 'unknown', category: '분석 오류', reason: response.error };
      applyAnalysisResult(blockId, errResult);
      notifyBlockAnalyzed(blockId, errResult);
      sendUpdateStatus(errResult, detectedLang, blockId);
      return;
    }

    if (response && isLockedVerdict(response.riskLevel)) {
      lockedBlocks.add(blockId);
      if (debounceTimers.has(blockId)) {
        clearTimeout(debounceTimers.get(blockId));
        debounceTimers.delete(blockId);
      }
      setCachedResult(codeHash, response);
      // danger 판정은 영구 차단 블록리스트에 저장
      if (response.riskLevel === 'danger') {
        addToBlocklist(codeHash, response);
      }
    }

    properlyAnalyzed.add(blockId);
    applyAnalysisResult(blockId, response);
    notifyBlockAnalyzed(blockId, response);
    sendUpdateStatus(response, detectedLang, blockId);

  } catch (error) {
    console.error('[AI Script Monitor] 분석 오류:', error);
    const errResult = { riskLevel: 'unknown', category: '통신 오류', reason: '서버 연결에 실패했습니다.' };
    applyAnalysisResult(blockId, errResult);
    notifyBlockAnalyzed(blockId, errResult);
    sendUpdateStatus(errResult, detectedLang, blockId);
  }
}

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

let _loadedBlocklist = {};

function tryBlocklistBlock(block) {
  if (!block.code || block.code.trim().length < 10) return false;
  const codeHash = hashCode(block.code);
  const entry = _loadedBlocklist[codeHash];
  if (!entry) return false;
  console.log('[ASM] 블록리스트 즉시 차단:', block.blockId, 'hash=' + codeHash);
  lockedBlocks.add(block.blockId);
  properlyAnalyzed.add(block.blockId);
  analyzedHashes.add(codeHash);
  applyAnalysisResult(block.blockId, entry);
  return true;
}

// 블록리스트를 로드하고 초기 블록 처리
getBlocklist().then((blocklist) => {
  _loadedBlocklist = blocklist;
  const count = Object.keys(blocklist).length;
  if (count > 0) console.log('[ASM] 블록리스트 로드:', count, '개');

  // 이미 DOM에 있는 코드 블록 스캔 (페이지 로드 시점)
  const initialBlocks = extractNewCodeBlocks();
  for (const block of initialBlocks) {
    if (tryBlocklistBlock(block)) continue;
    registerBlockForMessage(block.blockId, block.element);
    scheduleAnalysis(block.blockId, block.code, block.language, block.blurTarget, block.element);
  }
});

// 메시지/코드 옵저버는 즉시 시작 (블록리스트 로드 전에도 블러는 적용)
observeAssistantMessages(handleNewMessage, handleMessageMutation);

observeCodeBlocks(
  (block) => {
    // 블록리스트 우선 확인 (비동기 로드 완료 후에는 즉시 차단)
    if (tryBlocklistBlock(block)) return;
    registerBlockForMessage(block.blockId, block.element);
    // 스트리밍 중인 메시지의 코드 블록은 등록만 하고 분석은 하지 않음.
    // 스트리밍이 끝나면 idle 타이머 → rescanMessageBlocks에서 완성된 코드로 분석.
    // 이렇게 해야 불완전한 코드로 먼저 분석(safe) → 완성 후 재분석(caution)으로
    // 결과가 뒤바뀌는 현상을 방지할 수 있다.
    const msgId = blockToMessage.get(block.blockId);
    const msgState = msgId && messageStates.get(msgId);
    const isLiveMessage = msgState && !msgState.settled;
    if (isLiveMessage) {
      console.log('[ASM-DEBUG] 스트리밍 중 — 분석 보류:', block.blockId);
      return;
    }
    scheduleAnalysis(block.blockId, block.code, block.language, block.blurTarget, block.element);
  },
  (blockId, newCode, element) => {
    // 스트리밍 중인 메시지의 블록은 업데이트도 보류 (rescan에서 처리)
    const msgId = blockToMessage.get(blockId);
    const msgState = msgId && messageStates.get(msgId);
    if (msgState && !msgState.settled) return;

    // 내용 업데이트 — 이전에 짧아서 스킵됐거나 내용이 바뀐 경우 재분석
    lockedBlocks.delete(blockId);
    const existing = latestCodeMap.get(blockId);
    const lang = existing ? existing.language : 'unknown';
    const bt = existing ? existing.blurTarget : element;
    scheduleAnalysis(blockId, newCode, lang, bt, element);
  }
);

console.log('[AI Script Monitor] Content Script 로드 완료 (Message-Blur 모드)');
