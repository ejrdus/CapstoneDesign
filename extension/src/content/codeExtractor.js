/**
 * DOM에서 AI 응답의 코드 블록을 감지하고 추출하는 모듈
 * ChatGPT, Claude, Gemini 등 주요 AI 서비스의 코드 블록 선택자를 지원
 */

const CODE_BLOCK_SELECTORS = {
  chatgpt: 'pre code, .code-block__code',
  claude: 'pre code, .code-block',
  gemini: 'pre code, .code-container',
};

/**
 * 현재 페이지에서 코드 블록을 추출
 * @returns {Array<{code: string, language: string, element: HTMLElement}>}
 */
export function extractCodeBlocks() {
  const codeBlocks = [];
  const allSelectors = Object.values(CODE_BLOCK_SELECTORS).join(', ');
  const elements = document.querySelectorAll(allSelectors);

  elements.forEach((el) => {
    const code = el.textContent.trim();
    if (code.length > 10) {
      codeBlocks.push({
        code,
        language: detectLanguageFromDOM(el),
        element: el,
      });
    }
  });

  return codeBlocks;
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
 * 새로운 코드 블록이 추가되는지 감시하는 MutationObserver 설정
 * @param {Function} callback - 새 코드 블록 발견 시 호출할 콜백
 */
export function observeCodeBlocks(callback) {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        const newCodeBlocks = extractCodeBlocks();
        if (newCodeBlocks.length > 0) {
          callback(newCodeBlocks);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return observer;
}
