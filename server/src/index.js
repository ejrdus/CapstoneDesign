require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const analyzeRoute = require('./routes/analyze');
const adminRoute = require('./routes/admin');
const errorHandler = require('./middleware/errorHandler');
const rateLimit = require('./middleware/rateLimit');
const { analyzeLimiter } = require('./middleware/rateLimit');
const { apiKeyGate } = require('./middleware/apiKey');

// DB 초기화 (모듈 로드 시 자동 실행)
require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// 프록시 뒤 배포 시 req.ip 정확도를 위해 신뢰할 프록시 홉 수 설정.
// 기본 0(미신뢰) — nginx 등 뒤에 두면 .env에 TRUST_PROXY=1 설정.
app.set('trust proxy', Number(process.env.TRUST_PROXY) || 0);

// 미들웨어
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(rateLimit);

// 요청 로깅
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// 라우트
// /api/analyze는 유료 LLM 호출을 유발하므로 전용 레이트리밋 + (선택적) API키 게이트 적용
app.use('/api/analyze', analyzeLimiter, apiKeyGate, analyzeRoute);
app.use('/api/admin', adminRoute);

// 관리자 페이지 정적 파일 서빙
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));
// SPA 라우팅 — /admin 하위 경로는 모두 index.html로
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
});

// 헬스 체크
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 에러 핸들링
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[AI Script Monitor] 서버 시작: http://localhost:${PORT}`);
  console.log(`[AI Script Monitor] 관리자 페이지: http://localhost:${PORT}/admin`);
});

module.exports = app;
