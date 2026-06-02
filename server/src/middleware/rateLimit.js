const rateLimit = require('express-rate-limit');

// 전역 기본 제한 (모든 요청)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: Number(process.env.RATE_LIMIT_MAX) || 30, // 분당 30회
  message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 분석 전용 제한 — /api/analyze 호출은 유료 LLM 호출을 유발하므로 더 엄격하게.
// 비용 폭탄(cost-bomb) 방어용. 환경변수로 분당 한도 조절 가능.
const analyzeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: Number(process.env.ANALYZE_RATE_LIMIT_MAX) || 20,
  message: { error: '분석 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = limiter;
module.exports.analyzeLimiter = analyzeLimiter;
