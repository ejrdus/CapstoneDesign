/**
 * 사용자 코드 비식별화 모듈
 * - LLM API로 전송하기 전, 민감 정보를 마스킹
 * - DB 저장 시에도 비식별화된 버전 사용
 *
 * 2단계 검사:
 *   1) ANONYMIZATION_RULES — 알려진 형식의 키/토큰/IP/경로/DB URL 등을 정규식으로 매칭
 *   2) entropyScan — 변수명 힌트 또는 Shannon entropy가 높은 문자열 리터럴 마스킹
 *      (비정형 비밀번호, 커스텀 토큰 커버)
 */

const ANONYMIZATION_RULES = [
  // === 자격증명 — 구체적인 형식 우선 (포괄적인 api_key_assignment 보다 먼저) ===
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
    name: 'api_key_assignment',
    pattern: /(?:api[_-]?key|apikey|token|secret)\s*[:=]\s*["']([A-Za-z0-9_\-]{20,})["']/gi,
    replacement: 'API_KEY="[REDACTED_KEY]"',
  },
  {
    name: 'password_assignment',
    pattern: /(?:password|passwd|pwd|passphrase)\s*[:=]\s*["']([^"']{4,})["']/gi,
    replacement: 'password="[REDACTED_PASSWORD]"',
  },
  {
    name: 'slack_token',
    pattern: /xox[bporeas]-[A-Za-z0-9-]{10,}/g,
    replacement: '[REDACTED_SLACK_TOKEN]',
  },
  {
    name: 'stripe_key',
    pattern: /(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{20,}/g,
    replacement: '[REDACTED_STRIPE_KEY]',
  },
  {
    name: 'gitlab_token',
    pattern: /glpat-[A-Za-z0-9_-]{20,}/g,
    replacement: '[REDACTED_GITLAB_TOKEN]',
  },
  {
    name: 'sendgrid_key',
    pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g,
    replacement: '[REDACTED_SENDGRID_KEY]',
  },
  {
    name: 'twilio_sid',
    pattern: /\b(?:AC|SK)[a-f0-9]{32}\b/g,
    replacement: '[REDACTED_TWILIO_SID]',
  },
  {
    name: 'google_api_key',
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
    replacement: '[REDACTED_GOOGLE_KEY]',
  },
  {
    name: 'private_key',
    pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },

  // === DB / 서비스 connection URL (자격증명 포함) ===
  {
    // postgresql://user:pass@host:port/db, mongodb://, mysql://, redis://, mssql://
    name: 'db_connection_string',
    pattern: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis(?:s)?|amqps?|mssql)\:\/\/[^"'\s]+/g,
    replacement: '[REDACTED_DB_URL]',
  },

  // === HTTP Authorization 헤더 ===
  {
    name: 'bearer_token_header',
    pattern: /(["']?)(?:Authorization|authorization)\1\s*[:=]\s*["']Bearer\s+[A-Za-z0-9._\-+/=]{8,}["']/g,
    replacement: '"Authorization": "Bearer [REDACTED_BEARER]"',
  },
  {
    name: 'basic_auth_header',
    pattern: /["']Basic\s+[A-Za-z0-9+/=]{8,}["']/g,
    replacement: '"Basic [REDACTED_BASIC]"',
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

// === Entropy 기반 검사 ===
const ENTROPY_MIN_LENGTH = 32;     // 짧은 문자열은 false positive 위험
const ENTROPY_THRESHOLD = 4.5;     // Shannon entropy bits/char (대략 64 chars 알파벳숫자 random ≈ 5.5)
const ENTROPY_MIN_LENGTH_HINTED = 12; // 변수명에 password/secret/token/key 있으면 길이 기준 완화
const ENTROPY_THRESHOLD_HINTED = 3.0; // 힌트 있을 때 entropy 기준 완화

// UUID·해시 같은 의미 있는 형식은 entropy 검사에서 제외 (false positive 방지)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALREADY_REDACTED = /^\[REDACTED_[A-Z_]+\]$/;

function shannonEntropy(s) {
  const freq = Object.create(null);
  for (const c of s) freq[c] = (freq[c] || 0) + 1;
  let h = 0;
  const n = s.length;
  for (const c in freq) {
    const p = freq[c] / n;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * 문자열 리터럴 추출 (Python·JS·Shell 따옴표 — 단일/이중)
 * 줄 단위로 처리해서 multi-line string은 무시 (false positive 방지)
 */
function findStringLiterals(code) {
  const literals = [];
  const lines = code.split('\n');
  let offset = 0;
  for (const line of lines) {
    // " 또는 '로 감싸진 문자열 (이스케이프된 따옴표 미고려 — 충분)
    const re = /(["'])((?:(?!\1).){4,})\1/g;
    let m;
    while ((m = re.exec(line))) {
      const value = m[2];
      const start = offset + m.index + 1;
      literals.push({ value, start, end: start + value.length, line });
    }
    offset += line.length + 1;
  }
  return literals;
}

/**
 * 문자열 리터럴 중 entropy 높은 것을 [REDACTED_HIGH_ENTROPY]로 마스킹
 * 변수명에 password/secret/token/key 힌트가 있으면 기준 완화
 */
function entropyScan(code) {
  const literals = findStringLiterals(code);
  const replacements = [];
  let result = code;
  let shift = 0;

  for (const lit of literals) {
    if (lit.value.length < ENTROPY_MIN_LENGTH_HINTED) continue;
    if (ALREADY_REDACTED.test(lit.value)) continue;
    if (UUID_PATTERN.test(lit.value)) continue;

    // 알파벳숫자/기호로만 구성된 문자열인지 (자연어 텍스트 제외)
    if (!/^[A-Za-z0-9_\-./+=:]+$/.test(lit.value)) continue;

    // word boundary 없이 substring 검사 — `my_token`, `userPassword`, `apiKey` 같은
    // prefix/suffix가 붙은 변수명도 잡기 위함
    const hinted = /(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth_)/i.test(lit.line);
    const minLen = hinted ? ENTROPY_MIN_LENGTH_HINTED : ENTROPY_MIN_LENGTH;
    const threshold = hinted ? ENTROPY_THRESHOLD_HINTED : ENTROPY_THRESHOLD;

    if (lit.value.length < minLen) continue;
    const h = shannonEntropy(lit.value);
    if (h < threshold) continue;

    // 마스킹 (offset shift 보정)
    const adjustedStart = lit.start + shift;
    const adjustedEnd = lit.end + shift;
    const marker = '[REDACTED_HIGH_ENTROPY]';
    result = result.slice(0, adjustedStart) + marker + result.slice(adjustedEnd);
    shift += marker.length - lit.value.length;
    replacements.push({ name: hinted ? 'entropy_hinted' : 'entropy_high', entropy: h.toFixed(2), length: lit.value.length });
  }

  return { result, replacements };
}

/**
 * 코드를 비식별화
 * @param {string} code - 원본 코드
 * @returns {{ anonymized: string, replacements: Array<{name, count}> }}
 */
function anonymize(code) {
  let result = code;
  const replacements = [];

  // 1단계: 알려진 형식의 정규식 규칙
  for (const rule of ANONYMIZATION_RULES) {
    const matches = result.match(rule.pattern);
    if (matches && matches.length > 0) {
      result = result.replace(rule.pattern, rule.replacement);
      replacements.push({ name: rule.name, count: matches.length });
    }
  }

  // 2단계: entropy 기반 검사 (정규식이 못 잡은 비정형 비밀)
  const entropyResult = entropyScan(result);
  result = entropyResult.result;
  if (entropyResult.replacements.length > 0) {
    const hintedCount = entropyResult.replacements.filter((r) => r.name === 'entropy_hinted').length;
    const highCount = entropyResult.replacements.filter((r) => r.name === 'entropy_high').length;
    if (hintedCount > 0) replacements.push({ name: 'entropy_hinted', count: hintedCount });
    if (highCount > 0) replacements.push({ name: 'entropy_high', count: highCount });
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

module.exports = {
  anonymize,
  logRedactions,
  shannonEntropy,
  entropyScan,
  ANONYMIZATION_RULES,
};
