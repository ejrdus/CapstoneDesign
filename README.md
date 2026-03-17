# AI Script Monitor

생성형 AI 응답의 문맥 분석을 통한 악성 스크립트 모니터링 크롬 확장 프로그램

## 프로젝트 구조

```
ai-script-monitor/
├── extension/    # 크롬 확장 프로그램 (Manifest V3 + React)
├── server/       # 백엔드 서버 (Node.js + Express)
└── docs/         # 프로젝트 문서
```

## 시작하기

### 백엔드 서버
```bash
cd server
npm install
cp .env.example .env  # API 키 설정
npm run dev
```

### 크롬 확장 프로그램
```bash
cd extension
npm install
npm run build
```
Chrome → 확장 프로그램 관리 → 개발자 모드 → `extension/dist` 폴더 로드

## 팀 석가모니
- 서효리 (팀장) - 크롬 확장 프로그램 개발
- 김덕연 - 시스템 아키텍처 / LLM 보안 분석 모듈
- 이인화 - LLM API 연동 / 위험도 판정 모듈
