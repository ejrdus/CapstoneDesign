/**
 * Anonymizer 단위 테스트 — 정규식 규칙 + entropy 검사 검증
 *
 * 각 케이스는 (1) 매칭되어야 할 [REDACTED_*] 마커가 결과에 등장하는지,
 * (2) 정상 코드는 false positive 없이 통과하는지 확인.
 */

const { anonymize } = require('../src/utils/anonymizer');

let pass = 0;
let fail = 0;
const failures = [];

function expect(name, code, mustContain = [], mustNotContain = []) {
  const { anonymized, replacements } = anonymize(code);
  const missing = mustContain.filter((m) => !anonymized.includes(m));
  const wrongPresent = mustNotContain.filter((m) => anonymized.includes(m));

  if (missing.length === 0 && wrongPresent.length === 0) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}`);
    if (missing.length) console.log(`     누락: ${missing.join(', ')}`);
    if (wrongPresent.length) console.log(`     남아있음: ${wrongPresent.join(', ')}`);
    console.log(`     replacements: ${JSON.stringify(replacements)}`);
    console.log(`     결과: ${anonymized.replace(/\n/g, ' \\n ')}`);
    failures.push(name);
  }
}

console.log('=== Anonymizer 테스트 ===\n');

console.log('[1] 기존 규칙 회귀');
expect(
  'AWS Access Key',
  'aws_key = "AKIAIOSFODNN7EXAMPLE"',
  ['[REDACTED_AWS_KEY]'],
  ['AKIAIOSFODNN7EXAMPLE'],
);
expect(
  'JWT 토큰',
  'token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"',
  ['[REDACTED_JWT]'],
);
expect(
  'GitHub PAT',
  'gh_token = "ghp_1234567890abcdef1234567890abcdef1234"',
  ['[REDACTED_GH_TOKEN]'],
);
expect(
  '이메일',
  'user = "alice@example.com"',
  ['[REDACTED_EMAIL]'],
  ['alice@example.com'],
);
expect(
  '사설 IP',
  'host = "192.168.1.100"',
  ['[REDACTED_INTERNAL_IP]'],
);

console.log('\n[2] 신규 정규식 규칙');
expect(
  'Slack bot 토큰',
  'slack = "xoxb-' + '1234567890-1234567890-AbCdEfGhIjKlMnOpQrStUvWxYz"',
  ['[REDACTED_SLACK_TOKEN]'],
);
expect(
  'Stripe 라이브 키',
  'stripe = "sk_live_' + '51HqLp0KsXm9zABCDEFGHIJKLMNOPQRSTUVWXYZabcd"',
  ['[REDACTED_STRIPE_KEY]'],
);
expect(
  'GitLab PAT',
  'gl = "glpat-abcdefghijklmnopqrstuv"',
  ['[REDACTED_GITLAB_TOKEN]'],
);
expect(
  'Google API 키',
  'g_key = "AIzaSyB1234567890abcdefghijklmnopqrstuv"',
  ['[REDACTED_GOOGLE_KEY]'],
);
expect(
  'Postgres connection string',
  'db_url = "postgresql://admin:s3cret@db.internal.com:5432/myapp"',
  ['[REDACTED_DB_URL]'],
  ['s3cret', 'admin:'],
);
expect(
  'MongoDB SRV',
  'mongo = "mongodb+srv://user:pass@cluster0.mongodb.net/test"',
  ['[REDACTED_DB_URL]'],
);
expect(
  'Bearer 헤더',
  'headers = {"Authorization": "Bearer abc.def.ghi123456789"}',
  ['[REDACTED_BEARER]'],
  ['abc.def.ghi123456789'],
);
expect(
  '평문 password 할당',
  'password = "Hunter2!swordfish"',
  ['[REDACTED_PASSWORD]'],
  ['Hunter2!swordfish'],
);

console.log('\n[3] Entropy 기반 검사');
expect(
  '변수명 힌트 + 짧은 랜덤 토큰',
  'my_token = "aB3xZ9qLpW2vN8mK"',
  ['[REDACTED_HIGH_ENTROPY]', '[REDACTED_KEY]'].slice(0, 1), // 둘 중 하나 매칭
);
expect(
  '힌트 없는 긴 랜덤 토큰 (32자 이상)',
  'value = "Qx7Ks9pLm2Vc8Yn4Bw3Rt6Hj5Dz1Pq0Fg2Sl7Ke9X"',
  ['[REDACTED_HIGH_ENTROPY]'],
);
expect(
  'UUID는 false positive 아님',
  'request_id = "550e8400-e29b-41d4-a716-446655440000"',
  [],
  ['[REDACTED_HIGH_ENTROPY]'],
);
expect(
  '일반 영어 문장은 entropy 낮아 통과',
  'msg = "Welcome to the application server please log in"',
  [],
  ['[REDACTED_HIGH_ENTROPY]'],
);
expect(
  '짧은 일반 변수 값은 통과',
  'name = "production"',
  [],
  ['[REDACTED_HIGH_ENTROPY]', '[REDACTED_KEY]'],
);

console.log('\n[4] False positive 회귀 — 정상 코드는 마스킹 X');
expect(
  '경로/URL은 통과',
  'url = "https://github.com/user/repo/blob/main/README.md"',
  [],
  ['[REDACTED_HIGH_ENTROPY]'],
);
expect(
  '한글 문자열은 entropy 검사 미적용',
  'msg = "안녕하세요 환영합니다 오늘은 좋은 날입니다"',
  [],
  ['[REDACTED_HIGH_ENTROPY]'],
);

console.log(`\n=== 결과 ===`);
console.log(`Pass: ${pass}, Fail: ${fail}`);
if (fail > 0) {
  console.log(`실패한 테스트: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('✅ 모든 테스트 통과');
