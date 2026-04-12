/**
 * 요청 데이터 검증 모듈
 */

const SUPPORTED_LANGUAGES = [
  'python', 'bash', 'javascript', 'typescript', 'powershell',
  'java', 'c', 'cpp', 'go', 'ruby', 'php', 'rust', 'csharp',
  'sql', 'html', 'css', 'unknown',
];

/**
 * /api/analyze 요청 바디 검증
 */
function validateAnalyzeRequest(body) {
  if (!body || !body.code) {
    return { valid: false, message: 'code 필드가 필요합니다.' };
  }

  if (typeof body.code !== 'string') {
    return { valid: false, message: 'code는 문자열이어야 합니다.' };
  }

  if (body.code.trim().length < 5) {
    return { valid: false, message: '코드가 너무 짧습니다.' };
  }

  if (body.language && !SUPPORTED_LANGUAGES.includes(body.language)) {
    return { valid: false, message: `지원하지 않는 언어: ${body.language}` };
  }

  return { valid: true };
}

module.exports = { validateAnalyzeRequest };
