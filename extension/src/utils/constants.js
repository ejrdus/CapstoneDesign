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

// AI 서비스 이름 매핑
export const AI_SERVICE_NAMES = {
  'chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini',
};

/**
 * 현재 URL에서 AI 서비스 이름을 감지
 * @returns {string} AI 서비스 이름 (ChatGPT, Claude, Gemini, 또는 Unknown)
 */
export function detectAIService() {
  const hostname = window.location.hostname;
  for (const [pattern, name] of Object.entries(AI_SERVICE_NAMES)) {
    if (hostname.includes(pattern)) return name;
  }
  return 'Unknown';
}
