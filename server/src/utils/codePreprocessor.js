/**
 * 코드 전처리 모듈
 * - LLM 분석 전 마크다운 서식, 줄번호 등을 제거
 * - 캐시 적중률 향상을 위한 정규화(normalize) 단계 포함:
 *     동일한 코드의 사소한 차이(공백, 줄바꿈, 인코딩)로 인한 캐시 미스 방지.
 *     주의: LLM에 보내는 코드 자체는 정규화 후에도 의미가 유지돼야 한다.
 */

/**
 * 코드의 의미를 바꾸지 않는 사소한 차이를 제거해 정규화한다.
 * 동일한 코드의 사소한 변형(탭/공백, 빈 줄 수, trailing whitespace 등)이
 * 다른 캐시 키를 만들어내는 것을 막는다.
 */
function normalizeCode(code) {
  let s = code;

  // CRLF → LF (운영체제 차이 제거)
  s = s.replace(/\r\n?/g, '\n');

  // 탭 → 공백 4칸 (들여쓰기 차이 제거)
  s = s.replace(/\t/g, '    ');

  // 줄 끝 공백 제거
  s = s.replace(/[ \t]+$/gm, '');

  // 연속된 빈 줄(3줄 이상)을 2줄로 축약
  s = s.replace(/\n{3,}/g, '\n\n');

  // 파일 끝의 trailing newline은 1개로
  s = s.replace(/\n+$/, '\n');

  return s;
}

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

  // 정규화 — 동일 코드의 사소한 변형이 같은 캐시 키로 매핑되도록
  cleaned = normalizeCode(cleaned);

  // 너무 긴 코드는 잘라내기 (토큰 제한 대비)
  const MAX_LENGTH = 5000;
  if (cleaned.length > MAX_LENGTH) {
    cleaned = cleaned.substring(0, MAX_LENGTH) + '\n// ... (코드가 잘림)';
  }

  return cleaned;
}

module.exports = { preprocessCode, normalizeCode };
