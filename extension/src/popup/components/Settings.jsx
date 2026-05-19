import React, { useState, useEffect } from 'react';

export default function Settings() {
  const [serverUrl, setServerUrl] = useState('http://localhost:3000');
  const [autoAnalysis, setAutoAnalysis] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['serverUrl', 'settings'], (data) => {
      if (data.serverUrl) setServerUrl(data.serverUrl);
      if (data.settings) setAutoAnalysis(data.settings.autoAnalysis ?? true);
    });
  }, []);

  const handleSave = () => {
    chrome.storage.local.set({
      serverUrl,
      settings: { autoAnalysis },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="settings">
      <div className="settings-section">
        <div className="settings-section-title">서버 설정</div>
        <div className="setting-item">
          <label>분석 서버 주소</label>
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://localhost:3000"
          />
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">분석 설정</div>
        <div className="setting-item">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={autoAnalysis}
              onChange={(e) => setAutoAnalysis(e.target.checked)}
            />
            코드 감지 시 자동 분석
          </label>
        </div>
      </div>

      <button className="save-btn" onClick={handleSave}>
        {saved ? '저장 완료!' : '설정 저장'}
      </button>

      <div className="settings-section" style={{ marginTop: 16 }}>
        <div className="settings-section-title">데이터 관리</div>
        <button
          className="save-btn"
          style={{ background: '#dc2626' }}
          onClick={() => {
            chrome.storage.local.remove('analysisHistory', () => {
              alert('분석 기록이 초기화되었습니다.');
            });
          }}
        >
          분석 기록 초기화
        </button>
      </div>
    </div>
  );
}
