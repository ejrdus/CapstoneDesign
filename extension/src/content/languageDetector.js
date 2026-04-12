/**
 * 코드 스니펫의 프로그래밍 언어를 식별하는 모듈
 * Python, Bash, JavaScript, TypeScript, PowerShell, Java, C/C++, Go, Ruby, PHP, Rust, C# 등을 지원
 */

const LANGUAGE_PATTERNS = {
  python: [
    /^import\s+\w+/m,
    /^from\s+\w+\s+import/m,
    /def\s+\w+\s*\(/m,
    /print\s*\(/m,
    /if\s+__name__\s*==\s*['"]__main__['"]/m,
    /class\s+\w+.*:/m,
    /elif\s+/m,
    /except\s+\w+/m,
  ],
  bash: [
    /^#!\/bin\/(ba)?sh/m,
    /\bsudo\s+/m,
    /\bchmod\s+/m,
    /\bcurl\s+/m,
    /\bwget\s+/m,
    /\|\s*grep\b/m,
    /\becho\s+/m,
    /\bexport\s+\w+=/m,
  ],
  javascript: [
    /\bconst\s+\w+\s*=/m,
    /\blet\s+\w+\s*=/m,
    /\bfunction\s+\w+\s*\(/m,
    /=>\s*\{/m,
    /console\.(log|error|warn)\s*\(/m,
    /document\.\w+/m,
    /require\s*\(/m,
    /module\.exports/m,
  ],
  typescript: [
    /:\s*(string|number|boolean|any|void)\b/m,
    /interface\s+\w+/m,
    /type\s+\w+\s*=/m,
    /\w+<\w+>/m,
    /as\s+(string|number|any)\b/m,
    /export\s+(interface|type|enum)\s+/m,
  ],
  powershell: [
    /\$\w+\s*=/m,
    /\bGet-\w+/m,
    /\bSet-\w+/m,
    /\bInvoke-\w+/m,
    /\bWrite-Host\b/m,
    /\b-ExecutionPolicy\b/m,
  ],
  java: [
    /public\s+(static\s+)?class\s+/m,
    /public\s+static\s+void\s+main/m,
    /System\.out\.print/m,
    /import\s+java\./m,
    /private\s+(static\s+)?\w+\s+\w+/m,
    /new\s+\w+\s*\(/m,
  ],
  c: [
    /#include\s*[<"]/m,
    /int\s+main\s*\(/m,
    /printf\s*\(/m,
    /scanf\s*\(/m,
    /malloc\s*\(/m,
    /void\s+\w+\s*\(/m,
  ],
  cpp: [
    /#include\s*<(iostream|vector|string|map|algorithm)>/m,
    /std::/m,
    /cout\s*<</m,
    /cin\s*>>/m,
    /namespace\s+/m,
    /template\s*</m,
  ],
  go: [
    /^package\s+\w+/m,
    /func\s+\w+\s*\(/m,
    /fmt\.Print/m,
    /import\s*\(/m,
    /:=\s*/m,
    /go\s+func/m,
  ],
  ruby: [
    /^require\s+['"]/m,
    /def\s+\w+/m,
    /puts\s+/m,
    /class\s+\w+\s*</m,
    /\.each\s+do\s*\|/m,
    /end$/m,
  ],
  php: [
    /<\?php/m,
    /\$\w+\s*=/m,
    /echo\s+/m,
    /function\s+\w+\s*\(/m,
    /\$this->/m,
    /->[\w]+\(/m,
  ],
  rust: [
    /fn\s+\w+\s*\(/m,
    /let\s+mut\s+/m,
    /println!\s*\(/m,
    /use\s+std::/m,
    /impl\s+\w+/m,
    /pub\s+fn\s+/m,
  ],
  csharp: [
    /using\s+System/m,
    /namespace\s+\w+/m,
    /Console\.Write/m,
    /public\s+class\s+/m,
    /static\s+void\s+Main/m,
    /var\s+\w+\s*=/m,
  ],
  sql: [
    /\bSELECT\s+/mi,
    /\bFROM\s+/mi,
    /\bWHERE\s+/mi,
    /\bINSERT\s+INTO\s+/mi,
    /\bCREATE\s+TABLE\s+/mi,
    /\bDROP\s+TABLE\s+/mi,
  ],
  html: [
    /<html/mi,
    /<div[\s>]/mi,
    /<script[\s>]/mi,
    /<head>/mi,
    /<body>/mi,
    /<!DOCTYPE/mi,
  ],
  css: [
    /[\w-]+\s*:\s*[\w#]+;/m,
    /\.\w+\s*\{/m,
    /@media\s+/m,
    /@import\s+/m,
    /display\s*:\s*/m,
    /margin\s*:\s*/m,
  ],
};

// 언어 표시명 매핑
export const LANGUAGE_DISPLAY_NAMES = {
  python: 'Python',
  bash: 'Bash',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  powershell: 'PowerShell',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  go: 'Go',
  ruby: 'Ruby',
  php: 'PHP',
  rust: 'Rust',
  csharp: 'C#',
  sql: 'SQL',
  html: 'HTML',
  css: 'CSS',
  unknown: 'Unknown',
};

/**
 * 코드 스니펫의 언어를 감지
 * @param {string} code - 분석할 코드 문자열
 * @returns {string} 감지된 언어 ID
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

/**
 * 언어 ID를 표시명으로 변환
 * @param {string} langId - 언어 ID (e.g., 'python', 'javascript')
 * @returns {string} 표시명 (e.g., 'Python', 'JavaScript')
 */
export function getLanguageDisplayName(langId) {
  return LANGUAGE_DISPLAY_NAMES[langId] || langId;
}
