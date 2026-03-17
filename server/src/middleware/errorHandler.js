/**
 * 글로벌 에러 핸들러
 */
function errorHandler(err, req, res, next) {
  console.error('[AI Script Monitor] Error:', err.message);

  if (err.status === 429) {
    return res.status(429).json({
      error: 'OpenAI API 요청 한도를 초과했습니다.',
    });
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'development'
      ? err.message
      : '서버 내부 오류가 발생했습니다.',
  });
}

module.exports = errorHandler;
