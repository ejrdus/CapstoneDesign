/**
 * 관리자 API 라우트
 * - 로그인 / 회원가입 요청 / 승인 관리
 * - 분석 로그 전체 조회
 * - 대시보드 통계
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authMiddleware, superAdminOnly, generateToken } = require('../middleware/auth');

// ─── 인증 ──────────────────────────────────────────────────

/**
 * POST /api/admin/login
 * 관리자 로그인
 */
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);

  if (!admin) {
    return res.status(401).json({ error: '존재하지 않는 계정입니다.' });
  }

  if (!admin.approved) {
    return res.status(403).json({ error: '관리자 승인 대기 중입니다.' });
  }

  if (!bcrypt.compareSync(password, admin.password)) {
    return res.status(401).json({ error: '비밀번호가 일치하지 않습니다.' });
  }

  // 마지막 로그인 시간 업데이트
  db.prepare("UPDATE admins SET last_login = datetime('now', 'localtime') WHERE id = ?").run(admin.id);

  const token = generateToken(admin);

  res.json({
    token,
    admin: {
      id: admin.id,
      username: admin.username,
      role: admin.role,
    },
  });
});

/**
 * POST /api/admin/register
 * 관리자 가입 요청 (승인 필요)
 */
router.post('/register', (req, res) => {
  const { username, password, reason } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }

  if (username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: '아이디 3자 이상, 비밀번호 6자 이상이어야 합니다.' });
  }

  // 중복 확인
  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  const existingRequest = db.prepare("SELECT id FROM admin_requests WHERE username = ? AND status = 'pending'").get(username);

  if (existing) {
    return res.status(409).json({ error: '이미 존재하는 아이디입니다.' });
  }

  if (existingRequest) {
    return res.status(409).json({ error: '이미 가입 요청이 진행 중입니다.' });
  }

  const hashedPw = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO admin_requests (username, password, request_reason) VALUES (?, ?, ?)').run(username, hashedPw, reason || '');

  res.json({ message: '가입 요청이 접수되었습니다. 관리자 승인 후 접속 가능합니다.' });
});

/**
 * GET /api/admin/me
 * 현재 로그인한 관리자 정보
 */
router.get('/me', authMiddleware, (req, res) => {
  const admin = db.prepare('SELECT id, username, role, created_at, last_login FROM admins WHERE id = ?').get(req.admin.id);
  res.json(admin);
});

// ─── 분석 로그 ──────────────────────────────────────────────

/**
 * GET /api/admin/logs
 * 분석 로그 목록 조회 (페이지네이션, 필터링)
 */
router.get('/logs', authMiddleware, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const riskLevel = req.query.riskLevel;
  const aiService = req.query.aiService;
  const language = req.query.language;
  const search = req.query.search;

  let where = 'WHERE 1=1';
  const params = [];

  if (riskLevel) {
    where += ' AND risk_level = ?';
    params.push(riskLevel);
  }

  if (aiService) {
    where += ' AND ai_service = ?';
    params.push(aiService);
  }

  if (language) {
    where += ' AND language = ?';
    params.push(language);
  }

  if (search) {
    where += ' AND (code LIKE ? OR reason LIKE ? OR category LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  const total = db.prepare(`SELECT COUNT(*) as count FROM analysis_logs ${where}`).get(...params).count;
  const logs = db.prepare(`SELECT id, language, ai_service, risk_level, category, reason, details, analyzed_at, ip_address FROM analysis_logs ${where} ORDER BY analyzed_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  res.json({
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * GET /api/admin/logs/:id
 * 분석 로그 상세 조회 (코드 포함)
 */
router.get('/logs/:id', authMiddleware, (req, res) => {
  const log = db.prepare('SELECT * FROM analysis_logs WHERE id = ?').get(req.params.id);
  if (!log) {
    return res.status(404).json({ error: '로그를 찾을 수 없습니다.' });
  }
  res.json(log);
});

// ─── 대시보드 통계 ──────────────────────────────────────────

/**
 * GET /api/admin/stats
 * 대시보드 통계 데이터
 */
router.get('/stats', authMiddleware, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM analysis_logs').get().count;
  const danger = db.prepare("SELECT COUNT(*) as count FROM analysis_logs WHERE risk_level = 'danger'").get().count;
  const caution = db.prepare("SELECT COUNT(*) as count FROM analysis_logs WHERE risk_level = 'caution'").get().count;
  const safe = db.prepare("SELECT COUNT(*) as count FROM analysis_logs WHERE risk_level = 'safe'").get().count;

  // AI 서비스별 통계
  const byService = db.prepare(`
    SELECT ai_service, COUNT(*) as count,
      SUM(CASE WHEN risk_level = 'danger' THEN 1 ELSE 0 END) as danger_count,
      SUM(CASE WHEN risk_level = 'caution' THEN 1 ELSE 0 END) as caution_count,
      SUM(CASE WHEN risk_level = 'safe' THEN 1 ELSE 0 END) as safe_count
    FROM analysis_logs
    GROUP BY ai_service
  `).all();

  // 언어별 통계
  const byLanguage = db.prepare(`
    SELECT language, COUNT(*) as count,
      SUM(CASE WHEN risk_level = 'danger' THEN 1 ELSE 0 END) as danger_count
    FROM analysis_logs
    GROUP BY language
    ORDER BY count DESC
    LIMIT 10
  `).all();

  // 최근 7일 일별 통계
  const daily = db.prepare(`
    SELECT DATE(analyzed_at) as date, COUNT(*) as count,
      SUM(CASE WHEN risk_level = 'danger' THEN 1 ELSE 0 END) as danger_count
    FROM analysis_logs
    WHERE analyzed_at >= datetime('now', '-7 days', 'localtime')
    GROUP BY DATE(analyzed_at)
    ORDER BY date
  `).all();

  // 최근 위협 카테고리 TOP 5
  const topCategories = db.prepare(`
    SELECT category, COUNT(*) as count
    FROM analysis_logs
    WHERE risk_level IN ('danger', 'caution') AND category IS NOT NULL AND category != ''
    GROUP BY category
    ORDER BY count DESC
    LIMIT 5
  `).all();

  res.json({
    overview: { total, danger, caution, safe },
    byService,
    byLanguage,
    daily,
    topCategories,
  });
});

// ─── 관리자 관리 (superadmin 전용) ──────────────────────────

/**
 * GET /api/admin/requests
 * 가입 요청 목록
 */
router.get('/requests', authMiddleware, superAdminOnly, (req, res) => {
  const requests = db.prepare('SELECT id, username, request_reason, status, requested_at, reviewed_at, reviewed_by FROM admin_requests ORDER BY requested_at DESC').all();
  res.json(requests);
});

/**
 * POST /api/admin/requests/:id/approve
 * 가입 요청 승인
 */
router.post('/requests/:id/approve', authMiddleware, superAdminOnly, (req, res) => {
  const request = db.prepare('SELECT * FROM admin_requests WHERE id = ?').get(req.params.id);

  if (!request || request.status !== 'pending') {
    return res.status(404).json({ error: '유효하지 않은 요청입니다.' });
  }

  // admins 테이블에 추가
  db.prepare('INSERT INTO admins (username, password, role, approved) VALUES (?, ?, ?, ?)').run(request.username, request.password, 'admin', 1);

  // 요청 상태 업데이트
  db.prepare("UPDATE admin_requests SET status = 'approved', reviewed_at = datetime('now', 'localtime'), reviewed_by = ? WHERE id = ?").run(req.admin.username, req.params.id);

  res.json({ message: `${request.username} 계정이 승인되었습니다.` });
});

/**
 * POST /api/admin/requests/:id/reject
 * 가입 요청 거절
 */
router.post('/requests/:id/reject', authMiddleware, superAdminOnly, (req, res) => {
  const request = db.prepare('SELECT * FROM admin_requests WHERE id = ?').get(req.params.id);

  if (!request || request.status !== 'pending') {
    return res.status(404).json({ error: '유효하지 않은 요청입니다.' });
  }

  db.prepare("UPDATE admin_requests SET status = 'rejected', reviewed_at = datetime('now', 'localtime'), reviewed_by = ? WHERE id = ?").run(req.admin.username, req.params.id);

  res.json({ message: `${request.username} 요청이 거절되었습니다.` });
});

/**
 * GET /api/admin/admins
 * 관리자 목록
 */
router.get('/admins', authMiddleware, superAdminOnly, (req, res) => {
  const admins = db.prepare('SELECT id, username, role, approved, created_at, last_login FROM admins ORDER BY created_at DESC').all();
  res.json(admins);
});

/**
 * DELETE /api/admin/admins/:id
 * 관리자 삭제
 */
router.delete('/admins/:id', authMiddleware, superAdminOnly, (req, res) => {
  const targetId = parseInt(req.params.id);

  if (targetId === req.admin.id) {
    return res.status(400).json({ error: '자기 자신은 삭제할 수 없습니다.' });
  }

  const target = db.prepare('SELECT * FROM admins WHERE id = ?').get(targetId);
  if (!target) {
    return res.status(404).json({ error: '관리자를 찾을 수 없습니다.' });
  }

  db.prepare('DELETE FROM admins WHERE id = ?').run(targetId);
  res.json({ message: `${target.username} 계정이 삭제되었습니다.` });
});

module.exports = router;
