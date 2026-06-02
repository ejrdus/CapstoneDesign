/**
 * 분석 API 키 게이트 (선택적)
 *
 * 비용 폭탄(cost-bomb) 방어: /api/analyze 한 번 호출 = 유료 LLM 호출이므로,
 * 공개 엔드포인트를 무제한으로 두면 악의적 대량 호출로 비용이 폭증할 수 있다.
 *
 * 정책: env ANALYZE_API_KEY가 설정된 경우에만 강제한다(기본 비활성 — 하위호환).
 *       요청은 헤더 `x-api-key` 또는 `Authorization: Bearer <key>`로 키를 전달한다.
 *       프로덕션 배포 시 .env에 ANALYZE_API_KEY를 설정하고, 확장 프로그램 설정에서
 *       동일 키를 저장하면 된다.
 */

// 타이밍 공격 완화를 위한 상수시간 비교
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function apiKeyGate(req, res, next) {
  const expected = process.env.ANALYZE_API_KEY;
  if (!expected) return next(); // 미설정 시 게이트 비활성 (개발/하위호환)

  const headerKey = req.headers['x-api-key'];
  const authHeader = req.headers.authorization;
  const bearerKey = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : null;
  const provided = headerKey || bearerKey;

  if (provided && safeEqual(String(provided), String(expected))) {
    return next();
  }
  return res.status(401).json({ error: 'API 키가 필요합니다.' });
}

module.exports = { apiKeyGate };
