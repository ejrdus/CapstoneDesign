/**
 * 프로젝트 상수 정의
 */

// 위험 등급
export const RISK_LEVELS = {
  SAFE: 'safe',
  CAUTION: 'caution',
  DANGER: 'danger',
};

// 위험 카테고리
export const RISK_CATEGORIES = {
  FILE_SYSTEM: '파일 시스템 파괴',
  NETWORK: '무단 네트워크 접근',
  PRIVILEGE: '권한 상승',
  DATA_LEAK: '정보 유출',
  RANSOMWARE: '암호화/랜섬웨어',
  OBFUSCATION: '난독화를 통한 악성 행위 은폐',
  REVERSE_SHELL: '역방향 셸 연결',
};

// 지원 AI 서비스 URL 패턴
export const AI_SERVICE_PATTERNS = [
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'gemini.google.com',
];
