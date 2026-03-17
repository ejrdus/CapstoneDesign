/**
 * Background Service Worker
 * Content Script와 백엔드 서버 사이의 통신을 중계
 */

const SERVER_URL = 'http://localhost:3000';

// 분석 결과 캐시 (메모리)
const analysisCache = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_CODE') {
    handleAnalyzeCode(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // 비동기 응답을 위해 true 반환
  }

  if (message.type === 'UPDATE_STATUS') {
    // 최근 분석 결과를 storage에 저장 (Popup에서 읽기 위해)
    chrome.storage.local.get('analysisHistory', (data) => {
      const history = data.analysisHistory || [];
      history.unshift({ ...message.payload, timestamp: Date.now() });
      chrome.storage.local.set({
        analysisHistory: history.slice(0, 50), // 최근 50개만 유지
      });
    });
  }
});

/**
 * 백엔드 서버에 코드 분석 요청
 */
async function handleAnalyzeCode({ code, language }) {
  try {
    const response = await fetch(`${SERVER_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language }),
    });

    if (!response.ok) {
      throw new Error(`서버 응답 오류: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('[AI Script Monitor] 서버 통신 오류:', error);
    return {
      riskLevel: 'unknown',
      category: 'error',
      reason: '서버 연결 실패',
    };
  }
}
