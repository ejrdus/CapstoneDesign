/**
 * JWT 인증 미들웨어
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn('[AUTH] JWT_SECRET 환경변수가 설정되지 않았습니다. 기본값을 사용합니다. 프로덕션에서는 반드시 .env에 JWT_SECRET을 설정하세요.');
  return 'asm-default-jwt-secret-change-me';
})();

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
}

function superAdminOnly(req, res, next) {
  if (req.admin.role !== 'superadmin') {
    return res.status(403).json({ error: '최고 관리자 권한이 필요합니다.' });
  }
  next();
}

function generateToken(admin) {
  return jwt.sign(
    { id: admin.id, username: admin.username, role: admin.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

module.exports = { authMiddleware, superAdminOnly, generateToken, JWT_SECRET };
