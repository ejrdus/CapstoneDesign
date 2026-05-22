import React, { useState, useEffect } from 'react';

const THEME_STORAGE_KEY = 'asmTheme';

export default function Settings() {
  const [serverUrl, setServerUrl] = useState('http://localhost:3000');
  const [autoAnalysis, setAutoAnalysis] = useState(true);
  const [theme, setTheme] = useState('dark');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['serverUrl', 'settings', THEME_STORAGE_KEY], (data) => {
      if (data.serverUrl) setServerUrl(data.serverUrl);
      if (data.settings) setAutoAnalysis(data.settings.autoAnalysis ?? true);
      if (data[THEME_STORAGE_KEY]) setTheme(data[THEME_STORAGE_KEY]);
    });
  }, []);

  const handleSave = () => {
    chrome.storage.local.set({
      serverUrl,
      settings: { autoAnalysis },
      [THEME_STORAGE_KEY]: theme,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleThemeChange = (next) => {
    setTheme(next);
    // 즉시 반영 — 사용자가 저장 누르지 않아도 미리보기 가능
    document.documentElement.setAttribute('data-theme', next);
    chrome.storage.local.set({ [THEME_STORAGE_KEY]: next });
  };

  return (
    <div className="settings">
      <div className="settings-section">
        <div className="settings-section-title">테마</div>
        <div className="theme-toggle">
          <button
            className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
            onClick={() => handleThemeChange('dark')}
          >🌙 다크</button>
          <button
            className={`theme-option ${theme === 'light' ? 'active' : ''}`}
            onClick={() => handleThemeChange('light')}
          >☀️ 라이트</button>
        </div>
      </div>

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
