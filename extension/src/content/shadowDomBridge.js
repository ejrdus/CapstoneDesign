/**
 * Shadow DOM Closed 모드 우회 브릿지
 *
 * [전략]
 * Gemini는 커스텀 엘리먼트 내부에 closed Shadow DOM을 사용한다.
 * closed 모드에서는 외부에서 shadowRoot에 접근할 수 없으므로,
 * 페이지 로드 전(document_start)에 Element.prototype.attachShadow를
 * 오버라이드하여 모든 closed shadow root를 open으로 강제 전환한다.
 *
 * 이 스크립트는 content script가 아닌 **페이지 컨텍스트**에서 실행되어야 하므로
 * <script> 태그를 통해 주입한다.
 *
 * [보안 고려]
 * - Gemini 도메인에서만 동작 (manifest의 matches로 제한)
 * - 원본 attachShadow 참조를 보존하여 기능은 유지
 * - shadow root 목록을 window.__asmShadowRoots에 노출하여
 *   content script에서 접근 가능
 */

/**
 * 페이지 컨텍스트에 주입할 코드
 * - attachShadow를 오버라이드하여 closed → open 전환
 * - 생성된 shadow root를 추적 배열에 저장
 */
const INJECT_CODE = `
(function() {
  'use strict';

  // 이미 주입되었으면 스킵
  if (window.__asmShadowPatched) return;
  window.__asmShadowPatched = true;

  // 원본 attachShadow 보존
  const originalAttachShadow = Element.prototype.attachShadow;

  // 생성된 shadow root 추적
  window.__asmShadowRoots = [];

  Element.prototype.attachShadow = function(init) {
    // closed → open 으로 강제 전환
    const patchedInit = Object.assign({}, init, { mode: 'open' });

    const shadowRoot = originalAttachShadow.call(this, patchedInit);

    // 추적 배열에 추가
    window.__asmShadowRoots.push({
      host: this,
      shadowRoot: shadowRoot,
      originalMode: init.mode,
      tagName: this.tagName.toLowerCase(),
    });

    // content script에 알림 (CustomEvent)
    window.dispatchEvent(new CustomEvent('__asm_shadow_created', {
      detail: { tagName: this.tagName.toLowerCase() }
    }));

    return shadowRoot;
  };
})();
`;

/**
 * 페이지 컨텍스트에 스크립트 주입
 * document_start 시점에 호출되어야 Gemini 코드보다 먼저 실행됨
 */
export function injectShadowDomBridge() {
  // Gemini 도메인에서만 주입
  if (!window.location.hostname.includes('gemini.google.com')) return;

  const script = document.createElement('script');
  script.textContent = INJECT_CODE;
  (document.documentElement || document.head || document.body).appendChild(script);
  script.remove(); // DOM에서 제거해도 이미 실행됨

  console.log('[AI Script Monitor] Shadow DOM 브릿지 주입 완료 (Gemini)');
}

/**
 * 현재까지 생성된 모든 shadow root를 반환
 * content script에서 호출하여 shadow DOM 내부를 탐색할 때 사용
 */
export function getTrackedShadowRoots() {
  // 페이지 컨텍스트의 window 객체에서 읽기
  // content script는 격리된 world이므로 직접 접근 불가 → wrappedJSObject 또는 이벤트 사용
  // Chrome MV3에서는 main world injection 방식 사용
  return window.__asmShadowRoots || [];
}

/**
 * 특정 요소의 shadow root를 가져온다 (open 모드로 패치된 경우)
 */
export function getShadowRoot(element) {
  return element.shadowRoot || null;
}

/**
 * 주어진 루트에서 shadow DOM을 재귀적으로 탐색하며
 * 셀렉터에 매칭되는 요소를 모두 찾는다.
 *
 * @param {Node} root - 탐색 시작점 (document, shadowRoot 등)
 * @param {string} selector - CSS 셀렉터
 * @returns {Element[]} 매칭된 요소 배열
 */
export function querySelectorAllDeep(root, selector) {
  const results = [];

  // 현재 루트에서 매칭
  if (root.querySelectorAll) {
    const matches = root.querySelectorAll(selector);
    results.push(...matches);
  }

  // 하위 요소의 shadow root 재귀 탐색
  const allElements = root.querySelectorAll ? root.querySelectorAll('*') : [];
  for (const el of allElements) {
    if (el.shadowRoot) {
      const deepResults = querySelectorAllDeep(el.shadowRoot, selector);
      results.push(...deepResults);
    }
  }

  return results;
}

/**
 * shadow DOM을 포함하여 가장 가까운 조상 요소를 찾는다.
 * (Element.closest()는 shadow boundary를 넘지 못하므로 대체 구현)
 *
 * @param {Element} element - 시작 요소
 * @param {string} selector - CSS 셀렉터
 * @returns {Element|null}
 */
export function closestDeep(element, selector) {
  let current = element;
  while (current) {
    if (current.matches && current.matches(selector)) return current;
    // shadow boundary를 넘어 host 요소로 이동
    if (current.parentElement) {
      current = current.parentElement;
    } else if (current.getRootNode && current.getRootNode() !== current) {
      const rootNode = current.getRootNode();
      current = rootNode.host || null;
    } else {
      current = null;
    }
  }
  return null;
}
