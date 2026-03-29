/**
 * DOM에서 AI 응답의 코드 블록을 감지하고 추출하는 모듈
 * ChatGPT, Claude, Gemini 등 주요 AI 서비스의 코드 블록 선택자를 지원
 *
 * [Blur-First 전략]
 * - MutationObserver가 새로 추가된 노드만 탐색 (전체 재스캔 X)
 * - 코드 블록 감지 즉시 블러 적용 후, 콜백으로 분석 요청
 * - data-asm-id 속성으로 중복 처리 방지
 */

import { applyPendingBlur } from './overlay';

const CODE_BLOCK_SELECTORS = {
  // ChatGPT: 2024~2026 다양한 DOM 구조 대응
  chatgpt: 'pre code, pre > code, div[class*="code"] code, .code-block__code, .markdown pre',
  // Claude
  claude: 'pre code, .code-block pre, .code-block code',
  // Gemini
  gemini: 'pre code, .code-container code, code-block code',
  // 범용 fallback
  fallback: 'pre:has(code)',
};

const ALL_SELECTORS = Object.values(CODE_BLOCK_SELECTORS).join(', ');

let blockIdCounter = 0;

/**
 * 고유 블록 ID 생성
 */
function generateBlockId() {
  return `asm-${Date.now()}-${++blockIdCounter}`;
}

/**
 * 요소가 이미 처리되었는지 확인
 */
function isProcessed(element) {
  return element.hasAttribute('data-asm-id');
}

/**
 * 요소를 처리 완료로 표시
 */
function markProcessed(element) {
  const id = generateBlockId();
  element.setAttribute('data-asm-id', id);
  return id;
}

/**
 * DOM 요소의 클래스명에서 언어 힌트를 추출
 */
function detectLanguageFromDOM(element) {
  const classList = element.className || '';
  const langMatch = classList.match(/language-(\w+)/);
  return langMatch ? langMatch[1] : 'unknown';
}

/**
 * 코드 블록의 <pre> 부모 요소를 찾아 반환 (블러 대상)
 * <pre> 태그가 없으면 본인 반환
 */
function getBlurTarget(codeElement) {
  const pre = codeElement.closest('pre');
  return pre || codeElement;
}

/**
 * 현재 페이지에서 아직 처리되지 않은 코드 블록을 추출
 * @returns {Array<{code: string, language: string, element: HTMLElement, blurTarget: HTMLElement, blockId: string}>}
 */
export function extractNewCodeBlocks() {
  const codeBlocks = [];
  const elements = document.querySelectorAll(ALL_SELECTORS);

  console.log(`[AI Script Monitor] 코드 블록 검색 — 선택자: ${ALL_SELECTORS}`);
  console.log(`[AI Script Monitor] 발견된 요소 수: ${elements.length}`);

  // fallback: 선택자로 못 찾으면 pre 태그 직접 검색
  if (elements.length === 0) {
    const preTags = document.querySelectorAll('pre');
    console.log(`[AI Script Monitor] fallback pre 태그 수: ${preTags.length}`);
    preTags.forEach((pre) => {
      if (isProcessed(pre)) return;
      const code = pre.textContent.trim();
      if (code.length > 5) {
        const blockId = markProcessed(pre);
        const blurTarget = pre;
        applyPendingBlur(blurTarget, blockId);
        codeBlocks.push({
          code,
          language: detectLanguageFromDOM(pre),
          element: pre,
          blurTarget,
          blockId,
        });
      }
    });
    return codeBlocks;
  }

  elements.forEach((el) => {
    if (isProcessed(el)) return;

    const code = el.textContent.trim();
    if (code.length > 5) {
      const blockId = markProcessed(el);
      const blurTarget = getBlurTarget(el);

      // 감지 즉시 블러 적용
      applyPendingBlur(blurTarget, blockId);

      codeBlocks.push({
        code,
        language: detectLanguageFromDOM(el),
        element: el,
        blurTarget,
        blockId,
      });
    }
  });

  return codeBlocks;
}

/**
 * 특정 노드 내에서 코드 블록을 탐색
 * MutationObserver에서 새로 추가된 노드에 대해서만 호출
 */
function findCodeBlocksInNode(node) {
  const results = [];

  if (node.nodeType !== Node.ELEMENT_NODE) return results;

  // 노드 자체가 코드 블록인 경우
  const matchesSelector = node.matches && (
    node.matches(ALL_SELECTORS) || node.tagName === 'PRE' || node.tagName === 'CODE'
  );

  if (matchesSelector && !isProcessed(node)) {
    const code = node.textContent.trim();
    if (code.length > 5) {
      const blockId = markProcessed(node);
      const blurTarget = getBlurTarget(node);
      applyPendingBlur(blurTarget, blockId);
      results.push({ code, language: detectLanguageFromDOM(node), element: node, blurTarget, blockId });
      console.log(`[AI Script Monitor] 새 코드 블록 감지: ${code.substring(0, 50)}...`);
    }
  }

  // 노드의 자식 중 코드 블록이 있는 경우
  if (node.querySelectorAll) {
    // 확장된 선택자 + pre 태그도 검색
    const extendedSelector = ALL_SELECTORS + ', pre';
    const children = node.querySelectorAll(extendedSelector);
    children.forEach((el) => {
      if (isProcessed(el)) return;
      // pre 안에 이미 처리된 code가 있으면 스킵
      if (el.tagName === 'PRE' && el.querySelector('[data-asm-id]')) return;
      const code = el.textContent.trim();
      if (code.length > 5) {
        const blockId = markProcessed(el);
        const blurTarget = getBlurTarget(el);
        applyPendingBlur(blurTarget, blockId);
        results.push({ code, language: detectLanguageFromDOM(el), element: el, blurTarget, blockId });
        console.log(`[AI Script Monitor] 새 코드 블록 감지: ${code.substring(0, 50)}...`);
      }
    });
  }

  return results;
}

/**
 * 새로운 코드 블록이 추가되는지 감시하는 MutationObserver 설정
 *
 * [최적화 포인트]
 * - 새로 추가된 노드(addedNodes)만 검사 → 전체 재스캔 제거
 * - characterData 변경도 감지 → 스트리밍 중 코드 내용 업데이트 대응
 *
 * @param {Function} onNewBlock - 새 코드 블록 발견 시 호출 (단일 블록 단위)
 * @param {Function} onContentUpdate - 기존 블록의 내용이 업데이트될 때 호출
 */
export function observeCodeBlocks(onNewBlock, onContentUpdate) {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // 새 노드 추가 감지
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const addedNode of mutation.addedNodes) {
          const newBlocks = findCodeBlocksInNode(addedNode);
          newBlocks.forEach((block) => onNewBlock(block));
        }
      }

      // 기존 코드 블록 내용 변경 감지 (스트리밍 대응)
      if (mutation.type === 'characterData') {
        const parentEl = mutation.target.parentElement;
        if (parentEl && parentEl.closest && parentEl.closest(ALL_SELECTORS)) {
          const codeEl = parentEl.closest(ALL_SELECTORS);
          if (codeEl && isProcessed(codeEl)) {
            const blockId = codeEl.getAttribute('data-asm-id');
            onContentUpdate(blockId, codeEl.textContent.trim(), codeEl);
          }
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  return observer;
}
