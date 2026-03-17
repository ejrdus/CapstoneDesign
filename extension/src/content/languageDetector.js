/**
 * 코드 스니펫의 프로그래밍 언어를 식별하는 모듈
 * Python, Bash, JavaScript, PowerShell 등을 지원
 */

const LANGUAGE_PATTERNS = {
  python: [
    /^import\s+\w+/m,
    /^from\s+\w+\s+import/m,
    /def\s+\w+\s*\(/m,
    /print\s*\(/m,
    /if\s+__name__\s*==\s*['"]__main__['"]/m,
  ],
  bash: [
    /^#!\/bin\/(ba)?sh/m,
    /\bsudo\s+/m,
    /\bchmod\s+/m,
    /\bcurl\s+/m,
    /\bwget\s+/m,
    /\|\s*grep\b/m,
  ],
  javascript: [
    /\bconst\s+\w+\s*=/m,
    /\blet\s+\w+\s*=/m,
    /\bfunction\s+\w+\s*\(/m,
    /=>\s*\{/m,
    /console\.(log|error|warn)\s*\(/m,
    /document\.\w+/m,
  ],
  powershell: [
    /\$\w+\s*=/m,
    /\bGet-\w+/m,
    /\bSet-\w+/m,
    /\bInvoke-\w+/m,
    /\bWrite-Host\b/m,
    /\b-ExecutionPolicy\b/m,
  ],
};

/**
 * 코드 스니펫의 언어를 감지
 * @param {string} code - 분석할 코드 문자열
 * @returns {string} 감지된 언어 (python, bash, javascript, powershell, unknown)
 */
export function detectLanguage(code) {
  const scores = {};

  for (const [language, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
    scores[language] = patterns.reduce((score, pattern) => {
      return score + (pattern.test(code) ? 1 : 0);
    }, 0);
  }

  const bestMatch = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return bestMatch[1] > 0 ? bestMatch[0] : 'unknown';
}
