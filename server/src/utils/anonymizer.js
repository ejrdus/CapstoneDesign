/**
 * 사용자 코드 비식별화 모듈
 * - LLM API로 전송하기 전, 민감 정보를 마스킹
 * - DB 저장 시에도 비식별화된 버전 사용
 *
 * 마스킹 대상:
 *   API 키, JWT, AWS Access Key, 이메일, 사설 IP,
 *   사용자 홈 경로, 신용카드 번호, Private Key
 */

const ANONYMIZATION_RULES = [
  // === 자격증명 ===
  {
    name: 'api_key_assignment',
    pattern: /(?:api[_-]?key|apikey|token|secret)\s*[:=]\s*["']([A-Za-z0-9_\-]{20,})["']/gi,
    replacement: 'API_KEY="[REDACTED_KEY]"',
  },
  {
    name: 'aws_access_key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: '[REDACTED_AWS_KEY]',
  },
  {
    name: 'jwt_token',
    pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replacement: '[REDACTED_JWT]',
  },
  {
    name: 'github_token',
    pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g,
    replacement: '[REDACTED_GH_TOKEN]',
  },
  {
    name: 'private_key',
    pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },

  // === 개인정보 ===
  {
    name: 'email',
    pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    name: 'credit_card',
    pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    replacement: '[REDACTED_CARD]',
  },

  // === 네트워크 정보 ===
  {
    name: 'private_ip',
    pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
    replacement: '[REDACTED_INTERNAL_IP]',
  },
  // === 시스템 경로 ===
  {
    name: 'unix_user_path',
    pattern: /\/(?:home|Users)\/([\w.-]+)/g,
    replacement: '/home/[USER]',
  },
  {
    name: 'windows_user_path',
    pattern: /C:\\Users\\([\w.-]+)/g,
    replacement: 'C:\\Users\\[USER]',
  },
];

/**
 * 코드를 비식별화
 * @param {string} code - 원본 코드
 * @returns {{ anonymized: string, replacements: Array<{name, count}> }}
 */
function anonymize(code) {
  let result = code;
  const replacements = [];

  for (const rule of ANONYMIZATION_RULES) {
    const matches = result.match(rule.pattern);
    if (matches && matches.length > 0) {
      result = result.replace(rule.pattern, rule.replacement);
      replacements.push({ name: rule.name, count: matches.length });
    }
  }

  return { anonymized: result, replacements };
}

/**
 * 디버깅 로깅 (어떤 종류가 몇 개 마스킹됐는지)
 */
function logRedactions(replacements) {
  if (replacements.length === 0) return;
  const summary = replacements
    .map((r) => `${r.name}=${r.count}`)
    .join(', ');
  console.log(`[Anonymizer] redacted: ${summary}`);
}

module.exports = { anonymize, logRedactions, ANONYMIZATION_RULES };