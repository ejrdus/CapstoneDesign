# 시스템 아키텍처

## 전체 흐름
1. 사용자가 AI 서비스(ChatGPT, Claude, Gemini)에서 코드를 생성
2. Content Script가 DOM에서 코드 블록을 감지 및 추출
3. 언어 식별기가 Python/Bash/JS/PowerShell 분류
4. Background Script를 통해 백엔드 서버로 분석 요청
5. 서버에서 코드 전처리 → LLM 의미 분석 → 위험도 판정
6. 결과에 따라 경고 오버레이 표시 또는 코드 블록 차단

## 기술 스택
- **크롬 확장**: Manifest V3, React, Webpack
- **백엔드**: Node.js, Express
- **LLM API**: OpenAI GPT-4o-mini
- **통신**: REST API (JSON)
