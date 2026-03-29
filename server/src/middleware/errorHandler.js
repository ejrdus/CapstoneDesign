/**
 * 글로벌 에러 핸들러
 */
function errorHandler(err, req, res, next) {
  console.error('[AI Script Monitor] Error:', err.message);

  if (err.status === 429 || (err.message && err.message.includes('429'))) {
    return res.status(429).json({
      error: 'API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
    });
  }

  if (err.status === 401 || err.status === 403 || (err.message && err.message.includes('API_KEY'))) {
    return res.status(401).json({
      error: 'API 키가 유효하지 않습니다. 서버 설정을 확인해주세요.',
    });
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'development'
      ? err.message
      : '서버 내부 오류가 발생했습니다.',
  });
}

module.exports = errorHandler;
