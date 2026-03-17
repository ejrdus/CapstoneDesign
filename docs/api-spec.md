# API 명세

## POST /api/analyze

코드 보안 분석 요청

### Request
```json
{
  "code": "import os\nos.remove('/')",
  "language": "python"
}
```

### Response
```json
{
  "riskLevel": "danger",
  "category": "파일 시스템 파괴",
  "reason": "루트 디렉토리 삭제를 시도하는 코드입니다.",
  "details": { ... },
  "analyzedAt": "2026-03-17T12:00:00.000Z"
}
```

### riskLevel 값
- `safe` - 안전: 악성 행위 없음
- `caution` - 주의: 잠재적 위험 있으나 맥락에 따라 정상일 수 있음
- `danger` - 위험: 명백한 악성 행위 감지

## GET /health
서버 상태 확인
