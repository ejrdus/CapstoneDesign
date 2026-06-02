/**
 * SQLite 데이터베이스 설정
 * - 분석 로그 저장
 * - 관리자 계정 관리
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'monitor.db');

// IP 주소는 개인정보이므로 원문 대신 솔트 해시로 저장한다(재식별 방지, 세션 그룹화는 유지).
const IP_HASH_SALT = process.env.IP_HASH_SALT || (() => {
  console.warn('[DB] IP_HASH_SALT 미설정 — 기본 솔트 사용. 프로덕션에서는 .env에 IP_HASH_SALT를 설정하세요.');
  return 'asm-default-ip-salt-change-me';
})();

function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(String(ip) + IP_HASH_SALT).digest('hex').slice(0, 16);
}

// 로그 보존 기간(일) — 초과분은 주기적으로 자동 삭제(저장 최소화 / 개인정보 보호).
const RETENTION_DAYS = Number(process.env.DATABASE_RETENTION_DAYS) || 90;

// data 디렉토리 생성
const fs = require('fs');
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// WAL 모드 활성화 (성능 개선)
db.pragma('journal_mode = WAL');

// 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    approved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS analysis_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    language TEXT,
    ai_service TEXT,
    risk_level TEXT,
    category TEXT,
    reason TEXT,
    details TEXT,
    analyzed_at TEXT DEFAULT (datetime('now', 'localtime')),
    ip_address TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    request_reason TEXT,
    status TEXT DEFAULT 'pending',
    requested_at TEXT DEFAULT (datetime('now', 'localtime')),
    reviewed_at TEXT,
    reviewed_by TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_logs_analyzed_at ON analysis_logs(analyzed_at);
  CREATE INDEX IF NOT EXISTS idx_logs_risk_level ON analysis_logs(risk_level);
  CREATE INDEX IF NOT EXISTS idx_logs_ai_service ON analysis_logs(ai_service);
`);

// 기본 관리자 계정 생성 (없을 경우)
const defaultAdmin = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
if (!defaultAdmin) {
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin1234';
  const hashedPw = bcrypt.hashSync(adminPass, 10);
  db.prepare('INSERT INTO admins (username, password, role, approved) VALUES (?, ?, ?, ?)').run(adminUser, hashedPw, 'superadmin', 1);
  console.log(`[DB] 기본 관리자 계정 생성: ${adminUser} (비밀번호는 환경변수 ADMIN_PASSWORD 사용)`);
}

// 보존 기간 초과 로그 자동 삭제 (시작 시 1회 + 24시간 주기)
function purgeOldLogs() {
  try {
    const info = db
      .prepare(`DELETE FROM analysis_logs WHERE analyzed_at < datetime('now', '-${RETENTION_DAYS} days', 'localtime')`)
      .run();
    if (info.changes > 0) {
      console.log(`[DB] 보존기간(${RETENTION_DAYS}일) 초과 로그 ${info.changes}건 삭제`);
    }
  } catch (e) {
    console.error('[DB] 로그 자동삭제 실패:', e.message);
  }
}

purgeOldLogs();
// unref(): 이 타이머가 프로세스 종료를 막지 않도록(스크립트가 DB 모듈을 require해도 정상 종료)
setInterval(purgeOldLogs, 24 * 60 * 60 * 1000).unref();

db.hashIp = hashIp;
db.purgeOldLogs = purgeOldLogs;

module.exports = db;
