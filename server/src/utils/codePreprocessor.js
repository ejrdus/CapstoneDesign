/**
 * 코드 전처리 모듈
 * LLM 분석 전 불필요한 마크다운 서식, 줄번호 등을 제거
 */

/**
 * 코드를 전처리하여 LLM 분석에 적합한 형태로 변환
 * @param {string} code - 원본 코드 문자열
 * @returns {string} 전처리된 코드
 */
function preprocessCode(code) {
  let cleaned = code;

  // 마크다운 코드 블록 구문 제거
  cleaned = cleaned.replace(/^```\w*\n?/gm, '');
  cleaned = cleaned.replace(/```$/gm, '');

  // 줄 번호 제거 (예: "1. ", "  1  ", "001 |" 등)
  cleaned = cleaned.replace(/^\s*\d+[\s|.:]+/gm, '');

  // 앞뒤 공백 정리
  cleaned = cleaned.trim();

  // 너무 긴 코드는 잘라내기 (토큰 제한 대비)
  const MAX_LENGTH = 5000;
  if (cleaned.length > MAX_LENGTH) {
    cleaned = cleaned.substring(0, MAX_LENGTH) + '\n// ... (코드가 잘림)';
  }

  return cleaned;
}

module.exports = { preprocessCode };
