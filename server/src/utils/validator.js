/**
 * 요청 데이터 검증 모듈
 */

const SUPPORTED_LANGUAGES = [
  'python', 'bash', 'javascript', 'typescript', 'powershell',
  'java', 'c', 'cpp', 'go', 'ruby', 'php', 'rust', 'csharp',
  'sql', 'html', 'css', 'unknown',
];

// 흔한 언어 표기 별칭 → 표준 키. 'python3', 'js' 같은 표기로 인한 오거부 방지 +
// 프리필터가 올바른 언어별 패턴을 적용하도록 정규화한다.
const LANGUAGE_ALIASES = {
  py: 'python', python3: 'python', py3: 'python',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript', nodejs: 'javascript',
  ts: 'typescript',
  golang: 'go',
  rs: 'rust',
  rb: 'ruby',
  'c++': 'cpp', cxx: 'cpp', cc: 'cpp', hpp: 'cpp', 'c#': 'csharp', cs: 'csharp',
  sh: 'bash', shell: 'bash', zsh: 'bash',
  ps1: 'powershell', pwsh: 'powershell',
  htm: 'html',
};

/**
 * 언어 문자열을 표준 키로 정규화한다(소문자/트림/별칭 매핑). 미지정 시 undefined 반환.
 */
function normalizeLanguage(language) {
  if (!language || typeof language !== 'string') return undefined;
  const key = language.toLowerCase().trim();
  if (LANGUAGE_ALIASES[key]) return LANGUAGE_ALIASES[key];
  return key;
}

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

  if (body.code.trim().length < 10) {
    return { valid: false, message: '코드가 너무 짧습니다 (최소 10자).' };
  }

  // 과도하게 긴 입력은 거부 (DoS/토큰 폭주 방지). express.json limit(100kb)보다 먼저 차단.
  const MAX_CODE_LENGTH = 50000;
  if (body.code.length > MAX_CODE_LENGTH) {
    return { valid: false, message: `코드가 너무 깁니다 (최대 ${MAX_CODE_LENGTH}자).` };
  }

  // 별칭을 정규화한 뒤 지원 언어인지 검사 (python3, js 등도 허용)
  if (body.language) {
    const normalized = normalizeLanguage(body.language);
    if (!SUPPORTED_LANGUAGES.includes(normalized)) {
      return { valid: false, message: `지원하지 않는 언어: ${body.language}` };
    }
  }

  if (body.aiService !== undefined && typeof body.aiService !== 'string') {
    return { valid: false, message: 'aiService는 문자열이어야 합니다.' };
  }

  if (body.sessionId !== undefined && typeof body.sessionId !== 'string') {
    return { valid: false, message: 'sessionId는 문자열이어야 합니다.' };
  }

  return { valid: true };
}

module.exports = { validateAnalyzeRequest, normalizeLanguage, SUPPORTED_LANGUAGES };
