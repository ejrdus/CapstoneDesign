/**
 * Content Script 진입점
 * AI 서비스 페이지에서 코드 블록을 감지하고 보안 분석을 요청
 */

import { extractCodeBlocks, observeCodeBlocks } from './codeExtractor';
import { detectLanguage } from './languageDetector';
import { showWarningOverlay } from './overlay';

const analyzedCodes = new Set();

/**
 * 코드 블록을 분석 요청
 */
async function analyzeCode(codeBlock) {
  const codeHash = hashCode(codeBlock.code);
  if (analyzedCodes.has(codeHash)) return;
  analyzedCodes.add(codeHash);

  const language = codeBlock.language !== 'unknown'
    ? codeBlock.language
    : detectLanguage(codeBlock.code);

  try {
    // Background Script를 통해 서버에 분석 요청
    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_CODE',
      payload: {
        code: codeBlock.code,
        language,
      },
    });

    if (response && response.riskLevel !== 'safe') {
      showWarningOverlay(codeBlock.element, response);
    }

    // Popup에 상태 업데이트
    chrome.runtime.sendMessage({
      type: 'UPDATE_STATUS',
      payload: { ...response, language },
    });
  } catch (error) {
    console.error('[AI Script Monitor] 분석 오류:', error);
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

// 초기 코드 블록 스캔
const initialBlocks = extractCodeBlocks();
initialBlocks.forEach(analyzeCode);

// 새 코드 블록 실시간 감시
observeCodeBlocks((newBlocks) => {
  newBlocks.forEach(analyzeCode);
});

console.log('[AI Script Monitor] Content Script 로드 완료');
