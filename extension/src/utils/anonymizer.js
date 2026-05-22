/**
 * 클라이언트 측 비식별화 모듈 (De-anonymization 지원)
 *
 * 서버로 코드를 전송하기 전 민감 정보를 마스킹하고, 원본 ↔ 마스킹 매핑을
 * 같이 반환한다. 매핑은 서버로 전송되지 않으며, 클라이언트의 service-worker
 * 메모리에만 저장된다. 사용자가 "원본 보기" 토글을 누르면 분석 결과 텍스트의
 * [REDACTED_*] 마커를 매핑으로 복원한다.
 *
 * 서버측 anonymizer.js의 핵심 규칙을 JS로 포팅한 subset. 서버측은 이를 backstop
 * 으로 한 번 더 적용하므로(클라이언트가 놓친 패턴 커버), 클라이언트가 다소
 * 누락해도 안전하다.
 */

const RULES = [
  // 자격증명 (구체적인 형식부터)
  {
    name: 'aws_access_key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    marker: 'AWS_KEY',
  },
  {
    name: 'jwt_token',
    pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    marker: 'JWT',
  },
  {
    name: 'github_token',
    pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g,
    marker: 'GH_TOKEN',
  },
  {
    name: 'slack_token',
    pattern: /xox[bporeas]-[A-Za-z0-9-]{10,}/g,
    marker: 'SLACK_TOKEN',
  },
  {
    name: 'google_api_key',
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
    marker: 'GOOGLE_KEY',
  },
  {
    name: 'db_connection_string',
    pattern: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis(?:s)?|amqps?|mssql):\/\/[^"'\s]+/g,
    marker: 'DB_URL',
  },
  // 평문 password 할당 — 값만 마스킹 (변수명은 보존)
  {
    name: 'password_assignment',
    pattern: /(?<=(?:password|passwd|pwd|passphrase)\s*[:=]\s*)["']([^"']{4,})["']/gi,
    marker: 'PASSWORD',
    captureGroup: 1,
  },
  // 개인정보
  {
    name: 'email',
    pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
    marker: 'EMAIL',
  },
  {
    name: 'credit_card',
    pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    marker: 'CARD',
  },
  // 네트워크
  {
    name: 'private_ip',
    pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
    marker: 'INTERNAL_IP',
  },
  // 시스템 경로
  {
    name: 'unix_user_path',
    pattern: /\/(?:home|Users)\/([\w.-]+)/g,
    marker: 'USER_PATH',
  },
  {
    name: 'windows_user_path',
    pattern: /C:\\Users\\([\w.-]+)/g,
    marker: 'WIN_USER_PATH',
  },
];

/**
 * 코드의 의미를 바꾸지 않는 사소한 차이를 제거해 정규화한다.
 * 서버측 codePreprocessor.normalizeCode와 동일한 규칙을 적용해 클라이언트
 * 캐시 키와 서버 LLM 입력이 같은 정규화 결과를 갖도록 보장한다.
 */
export function normalizeCode(code) {
  return code
    .replace(/\r\n?/g, '\n')         // CRLF → LF
    .replace(/\t/g, '    ')          // 탭 → 공백 4칸
    .replace(/[ \t]+$/gm, '')        // 줄 끝 공백 제거
    .replace(/\n{3,}/g, '\n\n')      // 빈 줄 3개 이상 → 2개
    .replace(/\n+$/, '\n');          // 파일 끝 newline 1개로
}

/**
 * 코드를 비식별화하고 매핑을 함께 반환.
 *
 * @param {string} code - 원본 코드
 * @returns {{ anonymized: string, mapping: Array<{ original: string, masked: string, rule: string }> }}
 *   - anonymized: 마스킹된 코드 (서버로 전송)
 *   - mapping: 복원용 매핑 (클라이언트 측에만 저장)
 */
export function anonymize(code) {
  let result = code;
  const mapping = [];
  let counter = 0;

  for (const rule of RULES) {
    // 인덱스 고유성 보장을 위해 새 정규식 객체 사용
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    let matches = [];
    let m;
    while ((m = pattern.exec(result))) {
      matches.push({ value: rule.captureGroup ? m[rule.captureGroup] : m[0], index: m.index, length: m[0].length });
      // 무한 루프 방지 (zero-length match 가드)
      if (m.index === pattern.lastIndex) pattern.lastIndex += 1;
    }
    if (matches.length === 0) continue;

    // 뒤에서부터 치환 (인덱스 무효화 방지)
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const match = matches[i];
      const original = match.value;
      const seen = mapping.find((map) => map.original === original);
      const masked = seen ? seen.masked : `[REDACTED_${rule.marker}_${counter}]`;
      if (!seen) {
        mapping.push({ original, masked, rule: rule.name });
        counter += 1;
      }
      if (rule.captureGroup) {
        // 따옴표는 유지하고 값만 치환: "secret" → "[REDACTED_PASSWORD_0]"
        const before = result.slice(0, match.index);
        const after = result.slice(match.index + match.length);
        const fullMatch = result.slice(match.index, match.index + match.length);
        const replaced = fullMatch.replace(original, masked);
        result = before + replaced + after;
      } else {
        result = result.slice(0, match.index) + masked + result.slice(match.index + match.length);
      }
    }
  }

  return { anonymized: result, mapping };
}

/**
 * 텍스트의 [REDACTED_*_<n>] 마커를 매핑을 사용해 원본으로 복원.
 * 매핑에 없는 마커는 그대로 둔다.
 *
 * @param {string} text - 마스킹된 텍스트 (분석 결과의 reason/evidence/intent 등)
 * @param {Array<{ original: string, masked: string }>} mapping
 * @returns {string} 복원된 텍스트
 */
export function deanonymize(text, mapping) {
  if (!text || !mapping || mapping.length === 0) return text;
  let result = text;
  // 긴 마커부터 치환 (짧은 마커가 긴 마커의 substring일 가능성 방지 — 사실 인덱스가
  // 달라서 충돌은 없지만, 안전 차원에서)
  const sorted = [...mapping].sort((a, b) => b.masked.length - a.masked.length);
  for (const { masked, original } of sorted) {
    // 문자열 그대로 split/join으로 안전하게 치환 (정규식 escape 불필요)
    if (result.includes(masked)) {
      result = result.split(masked).join(original);
    }
  }
  return result;
}

/**
 * 분석 결과 객체의 모든 텍스트 필드에 deanonymize 적용.
 */
export function deanonymizeResult(result, mapping) {
  if (!result || !mapping || mapping.length === 0) return result;
  const restored = { ...result };
  if (restored.reason) restored.reason = deanonymize(restored.reason, mapping);
  if (restored.category) restored.category = deanonymize(restored.category, mapping);
  if (restored.details) {
    const details = { ...restored.details };
    if (details.intent) details.intent = deanonymize(details.intent, mapping);
    if (Array.isArray(details.threats)) {
      details.threats = details.threats.map((t) => ({
        ...t,
        description: t.description ? deanonymize(t.description, mapping) : t.description,
        evidence: t.evidence ? deanonymize(t.evidence, mapping) : t.evidence,
      }));
    }
    restored.details = details;
  }
  return restored;
}
