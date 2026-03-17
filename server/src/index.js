require('dotenv').config();
const express = require('express');
const cors = require('cors');
const analyzeRoute = require('./routes/analyze');
const errorHandler = require('./middleware/errorHandler');
const rateLimit = require('./middleware/rateLimit');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(rateLimit);

// 라우트
app.use('/api/analyze', analyzeRoute);

// 헬스 체크
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 에러 핸들링
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[AI Script Monitor] 서버 시작: http://localhost:${PORT}`);
});

module.exports = app;
