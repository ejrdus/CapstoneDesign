/**
 * SQLite 데이터베이스 설정
 * - 분석 로그 저장
 * - 관리자 계정 관리
 */

const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'monitor.db');

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
  const hashedPw = bcrypt.hashSync('admin1234', 10);
  db.prepare('INSERT INTO admins (username, password, role, approved) VALUES (?, ?, ?, ?)').run('admin', hashedPw, 'superadmin', 1);
  console.log('[DB] 기본 관리자 계정 생성: admin / admin1234');
}

module.exports = db;
