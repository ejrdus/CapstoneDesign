/**
 * DOM에서 AI 응답의 코드 블록을 감지하고 추출하는 모듈
 * ChatGPT, Claude, Gemini 등 주요 AI 서비스의 코드 블록 감지를 지원
 *
 * [Blur-First 전략]
 * - MutationObserver가 새로 추가된 노드만 탐색 (전체 재스캔 X)
 * - 코드 블록 감지 즉시 블러 적용 후, 콜백으로 분석 요청
 * - data-asm-id 속성으로 중복 처리 방지
 *
 * [감지 전략 — 함수 기반 판별]
 * 셀렉터 매칭이 아닌 isCodeBlockElement() 함수로 판별한다.
 * ChatGPT의 새 DOM 구조처럼 <pre> 없이 <code class="hljs language-*">만
 * 사용하는 경우에도 잡을 수 있다.
 */

import { applyPendingBlur } from './overlay';

// ─── Assistant 메시지 감지 ─────────────────────────────────────
// 코드 블록뿐 아니라 AI 응답 메시지 전체를 블러 처리하기 위한 셀렉터/옵저버
const ASSISTANT_MESSAGE_SELECTORS = [
  '[data-message-author-role="assistant"]', // ChatGPT
  '[data-testid^="conversation-turn"][data-message-author-role="assistant"]',
  '[data-test-render-count] [data-message-author-role="assistant"]',
].join(', ');

let messageIdCounter = 0;
function generateMessageId() {
  return `asm-msg-${Date.now()}-${++messageIdCounter}`;
}

/**
 * 메시지의 canonical key를 얻는다.
 * ChatGPT가 부여하는 data-message-id (UUID)가 있으면 그것을 우선 사용 — React가
 * 컴포넌트를 재마운트해도 같은 응답이면 같은 ID이므로 중복 처리 방지에 가장 견고.
 * 없으면 임시 generated id를 부여.
 */
function getMessageKey(msg) {
  return msg.getAttribute('data-message-id') || msg.getAttribute('data-asm-msg-id') || null;
}

// 이미 처리된 메시지 키 집합 (중복 처리/배너 방지)
const processedMessageKeys = new Set();

/**
 * 처음 감지되는 시점의 메시지가 "스트리밍 중인 새 응답"인지 판별.
 * - 스트리밍은 항상 빈 div로 시작 → textContent가 거의 없음
 * - 히스토리 로드는 이미 완성된 텍스트가 들어있음
 *
 * 임계값(40자)은 짧은 응답("네", "OK" 등)도 스트리밍으로 인정할 수 있게
 * 보수적으로 잡음. 단, 페이지 로드 직후엔 모든 메시지를 historical로 간주.
 */
const STREAMING_TEXT_THRESHOLD = 40;
const PAGE_LOAD_GRACE_MS = 1500; // 페이지 로드 직후 이 시간 동안 발견되는 메시지는 모두 historical
const pageLoadTime = Date.now();

function isLikelyStreaming(msg) {
  // 페이지 로드 직후에 발견되는 건 무조건 historical (히스토리 lazy load 대응)
  if (Date.now() - pageLoadTime < PAGE_LOAD_GRACE_MS) return false;

  // ChatGPT의 request placeholder는 실제 응답이 아님 — 무시
  const messageId = msg.getAttribute('data-message-id') || '';
  if (messageId.startsWith('request-placeholder')) return false;

  const text = (msg.textContent || '').trim();
  // 내용이 짧으면 스트리밍 시작 단계로 간주
  return text.length < STREAMING_TEXT_THRESHOLD;
}

/**
 * 새로 추가되는 assistant 메시지 요소를 감지한다.
 * - onNewMessage(msgId, msgEl): 새 메시지 생성 시점
 * - onMessageMutation(msgId, msgEl): 스트리밍 중 메시지 내용 변경 시점 (idle 감지용)
 *
 * 페이지 로드 시 이미 존재하던 메시지(대화 히스토리)는 블러 대상이 아니므로
 * mark만 해두고 콜백을 호출하지 않는다.
 */
export function observeAssistantMessages(onNewMessage, onMessageMutation) {
  // 초기 스캔 — 기존 메시지는 처리 완료로 마킹만 (블러 X)
  document.querySelectorAll(ASSISTANT_MESSAGE_SELECTORS).forEach((msg) => {
    if (!msg.hasAttribute('data-asm-msg-id')) {
      msg.setAttribute('data-asm-msg-id', generateMessageId());
      msg.setAttribute('data-asm-msg-state', 'historical');
    }
  });

  const observer = new MutationObserver((mutations) => {
    const newMessages = new Set();
    const mutatedMessages = new Set();

    for (const mutation of mutations) {
      // 1) 새 노드 추가에서 assistant 메시지 찾기
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches && node.matches(ASSISTANT_MESSAGE_SELECTORS)) {
          newMessages.add(node);
        }
        if (node.querySelectorAll) {
          node.querySelectorAll(ASSISTANT_MESSAGE_SELECTORS).forEach((m) => newMessages.add(m));
        }
      }

      // 2) attributes mutation — data-message-author-role이 나중에 설정되는 경우
      if (mutation.type === 'attributes' && mutation.attributeName === 'data-message-author-role') {
        const target = mutation.target;
        if (target && target.matches && target.matches(ASSISTANT_MESSAGE_SELECTORS)) {
          newMessages.add(target);
        }
      }

      // 3) mutation이 발생한 위치의 assistant 메시지 조상 → 내용 변경 알림
      let probe = mutation.target;
      if (probe && probe.nodeType === Node.TEXT_NODE) probe = probe.parentElement;
      if (probe && probe.nodeType === Node.ELEMENT_NODE && probe.closest) {
        const msg = probe.closest(ASSISTANT_MESSAGE_SELECTORS);
        if (msg) mutatedMessages.add(msg);
      }
    }

    // 중첩 제거 — 부모-자식 관계의 요소가 있으면 가장 바깥 요소만 남김
    const filtered = [...newMessages].filter((msg) => {
      for (const other of newMessages) {
        if (other !== msg && other.contains(msg)) return false;
      }
      return true;
    });

    // 새 메시지 처리 — canonical key(data-message-id)로 중복 방지
    for (const msg of filtered) {
      const key = msg.getAttribute('data-message-id');
      // 이미 처리한 키면 마킹만 갱신하고 콜백은 호출하지 않음
      if (key && processedMessageKeys.has(key)) {
        if (!msg.hasAttribute('data-asm-msg-id')) {
          msg.setAttribute('data-asm-msg-id', key);
        }
        continue;
      }
      if (msg.hasAttribute('data-asm-msg-id')) continue;
      // 이미 처리된 메시지 안에 중첩된 요소면 스킵
      if (msg.closest && msg.parentElement && msg.parentElement.closest('[data-asm-msg-id]')) continue;
      const id = key || generateMessageId();
      msg.setAttribute('data-asm-msg-id', id);
      if (isLikelyStreaming(msg)) {
        msg.setAttribute('data-asm-msg-state', 'live');
        if (key) processedMessageKeys.add(key);
        console.log(`[AI Script Monitor] Assistant 메시지 감지(streaming): ${id}`);
        onNewMessage(id, msg);
      } else {
        msg.setAttribute('data-asm-msg-state', 'historical');
        if (key) processedMessageKeys.add(key);
      }
    }

    // 기존 live 메시지의 내용 변경 → idle 타이머 리셋용
    for (const msg of mutatedMessages) {
      if (newMessages.has(msg)) continue;
      const id = msg.getAttribute('data-asm-msg-id');
      const state = msg.getAttribute('data-asm-msg-state');
      if (id && state === 'live') {
        onMessageMutation(id, msg);
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-message-author-role'],
  });

  // 폴링 폴백 — MutationObserver가 놓치는 케이스 대비. canonical key로 중복 방지
  setInterval(() => {
    const candidates = document.querySelectorAll(ASSISTANT_MESSAGE_SELECTORS);
    for (const msg of candidates) {
      const key = msg.getAttribute('data-message-id');
      // 이미 처리한 키면 attribute만 갱신하고 스킵 (React가 wipe했을 수 있음)
      if (key && processedMessageKeys.has(key)) {
        if (!msg.hasAttribute('data-asm-msg-id')) {
          msg.setAttribute('data-asm-msg-id', key);
        }
        continue;
      }
      if (msg.hasAttribute('data-asm-msg-id')) continue;
      // 이미 처리된 메시지 안에 중첩된 요소면 스킵
      if (msg.parentElement && msg.parentElement.closest('[data-asm-msg-id]')) continue;
      const id = key || generateMessageId();
      msg.setAttribute('data-asm-msg-id', id);
      if (isLikelyStreaming(msg)) {
        msg.setAttribute('data-asm-msg-state', 'live');
        if (key) processedMessageKeys.add(key);
        console.log(`[AI Script Monitor] (polling) Assistant 메시지 감지(streaming): ${id}`);
        onNewMessage(id, msg);
      } else {
        msg.setAttribute('data-asm-msg-state', 'historical');
        if (key) processedMessageKeys.add(key);
      }
    }
  }, 200);

  return observer;
}

/**
 * 외부에서 메시지 ID를 보장한다 — 없으면 만들어 live로 마킹.
 * 코드 블록을 등록할 때 메시지가 옵저버를 통해 잡히지 못한 케이스의 안전망.
 */
export function ensureMessageId(msgEl) {
  if (!msgEl) return null;
  let id = msgEl.getAttribute('data-asm-msg-id');
  if (!id) {
    id = generateMessageId();
    msgEl.setAttribute('data-asm-msg-id', id);
    msgEl.setAttribute('data-asm-msg-state', 'live');
  }
  return id;
}

let blockIdCounter = 0;

function generateBlockId() {
  return `asm-${Date.now()}-${++blockIdCounter}`;
}

function isProcessed(element) {
  return element.hasAttribute('data-asm-id');
}

function markProcessed(element) {
  const id = generateBlockId();
  element.setAttribute('data-asm-id', id);
  return id;
}

function detectLanguageFromDOM(element) {
  const classList = element.className || '';
  const langMatch = classList.match(/language-(\w+)/);
  if (langMatch) return langMatch[1];
  // 자식 <code>에서도 시도
  const codeChild = element.querySelector && element.querySelector('code[class*="language-"]');
  if (codeChild) {
    const m = (codeChild.className || '').match(/language-(\w+)/);
    if (m) return m[1];
  }
  return 'unknown';
}

/**
 * 어떤 요소가 "블러를 입혀야 할 코드 블록"인지 판별
 *
 * 포함:
 * - <pre> 태그 (거의 항상 코드 블록)
 * - <pre> 안의 <code>
 * - language-* / hljs 클래스를 가진 <code>
 * - 다중 라인 텍스트를 가진 <code>
 * - assistant 메시지 안의 의미 있는 길이의 <code>
 *
 * 제외:
 * - 인라인 코드 (한 줄짜리 짧은 <code>)
 * - 이미 처리된 요소의 자식
 */
function isCodeBlockElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = el.tagName;

  if (tag === 'PRE') return true;

  if (tag !== 'CODE') return false;

  // <code>가 <pre> 안에 있으면 코드 블록
  const parent = el.parentElement;
  if (parent && parent.tagName === 'PRE') return true;

  const cls = el.className || '';
  // language-* 또는 hljs 클래스가 있으면 코드 블록
  if (/(?:^|\s)(?:language-|hljs|whitespace-pre)/.test(cls)) return true;

  const text = el.textContent || '';
  // 다중 라인이면 코드 블록
  if (text.includes('\n')) return true;

  // assistant 메시지 안의 30자 이상 <code>는 코드 블록으로 간주
  // (인라인 짧은 코드는 제외)
  if (el.closest && el.closest('[data-message-author-role="assistant"]')) {
    if (text.length >= 30) return true;
  }

  return false;
}

/**
 * 블러를 적용할 시각적 컨테이너를 찾는다.
 * - <code>가 <pre> 안에 있으면 <pre>를 블러 (헤더 포함)
 * - 그렇지 않으면 가장 가까운 코드 블록 wrapper div를 시도
 * - 최후엔 <code> 자체를 블러
 */
function getBlurTarget(el) {
  if (el.tagName === 'PRE') return el;
  // <pre> 안의 <code>
  const pre = el.closest && el.closest('pre');
  if (pre) return pre;
  // ChatGPT 새 구조: code의 가장 가까운 wrapper div를 찾되
  // 너무 위(메시지 전체)까지 올라가지 않도록 가까운 한두 단계만
  let target = el;
  // 부모가 인라인이 아닌 div면 그쪽으로
  const p1 = el.parentElement;
  if (p1 && p1.tagName === 'DIV') target = p1;
  return target;
}

/**
 * 처리되지 않은 코드 블록 요소를 등록·블러하고 결과 객체를 만든다.
 * (이미 처리됐거나 부모가 처리된 경우 null 반환)
 */
function registerCodeBlock(el) {
  if (isProcessed(el)) return null;

  // <pre>인데 안에 이미 처리된 <code>가 있으면 스킵 (중복)
  if (el.tagName === 'PRE' && el.querySelector('[data-asm-id]')) return null;
  // <code>인데 부모 <pre>가 이미 처리됐으면 스킵 (중복)
  if (el.tagName === 'CODE') {
    const parentPre = el.closest('pre');
    if (parentPre && parentPre !== el && isProcessed(parentPre)) return null;
  }

  const blockId = markProcessed(el);
  const blurTarget = getBlurTarget(el);

  // 감지 즉시 블러 적용 (빈 블록도 포함 — 이후 스트리밍 텍스트가 처음부터 흐려짐)
  applyPendingBlur(blurTarget, blockId);

  const code = (el.textContent || '').trim();
  console.log(
    `[AI Script Monitor] 코드 블록 감지: <${el.tagName.toLowerCase()}> "${code.substring(0, 40)}..."`
  );

  return {
    code,
    language: detectLanguageFromDOM(el),
    element: el,
    blurTarget,
    blockId,
  };
}

/**
 * 주어진 루트 노드(자체 + 후손) 중 코드 블록 후보를 모두 찾아 처리
 */
function scanRoot(root, results) {
  if (!root || root.nodeType !== Node.ELEMENT_NODE) return;

  // 루트 자체
  if (isCodeBlockElement(root)) {
    const block = registerCodeBlock(root);
    if (block) results.push(block);
  }

  // 후손: <pre>와 <code>를 모두 훑되 isCodeBlockElement로 필터링
  if (root.querySelectorAll) {
    const candidates = root.querySelectorAll('pre, code');
    candidates.forEach((el) => {
      if (!isCodeBlockElement(el)) return;
      const block = registerCodeBlock(el);
      if (block) results.push(block);
    });
  }
}

/**
 * 현재 페이지에 있는 모든 코드 블록을 추출 (초기 스캔)
 */
export function extractNewCodeBlocks() {
  const results = [];
  scanRoot(document.body, results);
  console.log(`[AI Script Monitor] 초기 스캔 — 코드 블록 ${results.length}개 발견`);
  return results;
}

/**
 * 코드 블록 처리: 새 블록이면 블러+onNewBlock, 기존 블록이면 onContentUpdate
 */
function processCodeElement(el, onNewBlock, onContentUpdate) {
  if (!el || !isCodeBlockElement(el)) return;

  if (isProcessed(el)) {
    const blockId = el.getAttribute('data-asm-id');
    const code = (el.textContent || '').trim();
    onContentUpdate(blockId, code, el);
    return;
  }

  const block = registerCodeBlock(el);
  if (block) onNewBlock(block);
}

/**
 * MutationObserver — 스트리밍 코드 블록 실시간 감지
 *
 * ChatGPT는 빈 컨테이너를 먼저 붙이고 텍스트 노드를 점진적으로 추가하기 때문에
 * 다음 모든 경로를 검사해야 한다:
 *  - 새로 추가된 노드 자체와 후손
 *  - 추가된 텍스트 노드의 <pre>/<code> 조상
 *  - mutation.target이 <pre>/<code> 안에 있을 때 그 조상
 *  - characterData 변경 시 <pre>/<code> 조상
 */
export function observeCodeBlocks(onNewBlock, onContentUpdate) {
  const observer = new MutationObserver((mutations) => {
    const candidates = new Set();

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const addedNode of mutation.addedNodes) {
          if (addedNode.nodeType === Node.ELEMENT_NODE) {
            // 추가된 element 자체와 후손에서 코드 블록 후보 수집
            if (addedNode.tagName === 'PRE' || addedNode.tagName === 'CODE') {
              candidates.add(addedNode);
            }
            if (addedNode.querySelectorAll) {
              addedNode.querySelectorAll('pre, code').forEach((el) => candidates.add(el));
            }
            // 추가된 노드의 부모가 코드 블록일 수도 있음
            const parent = addedNode.parentElement;
            if (parent) {
              const ancestor = parent.closest && parent.closest('pre, code');
              if (ancestor) candidates.add(ancestor);
            }
          } else if (addedNode.nodeType === Node.TEXT_NODE) {
            // 텍스트 노드 추가 → 부모의 <pre>/<code> 조상
            const parent = addedNode.parentElement;
            if (parent) {
              const ancestor = parent.closest && parent.closest('pre, code');
              if (ancestor) candidates.add(ancestor);
            }
          }
        }

        // mutation이 발생한 컨테이너 자체도 검사
        if (mutation.target && mutation.target.nodeType === Node.ELEMENT_NODE) {
          const target = mutation.target;
          if (target.tagName === 'PRE' || target.tagName === 'CODE') {
            candidates.add(target);
          } else if (target.closest) {
            const ancestor = target.closest('pre, code');
            if (ancestor) candidates.add(ancestor);
          }
        }
      } else if (mutation.type === 'characterData') {
        const parent = mutation.target.parentElement;
        if (parent) {
          const ancestor = parent.closest && parent.closest('pre, code');
          if (ancestor) candidates.add(ancestor);
        }
      }
    }

    for (const el of candidates) {
      processCodeElement(el, onNewBlock, onContentUpdate);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  return observer;
}
