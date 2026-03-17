import React, { useState, useEffect } from 'react';

export default function Settings() {
  const [serverUrl, setServerUrl] = useState('http://localhost:3000');
  const [autoAnalysis, setAutoAnalysis] = useState(true);

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
  };

  return (
    <div className="settings">
      <div className="setting-item">
        <label>서버 주소</label>
        <input
          type="text"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
        />
      </div>
      <div className="setting-item">
        <label>
          <input
            type="checkbox"
            checked={autoAnalysis}
            onChange={(e) => setAutoAnalysis(e.target.checked)}
          />
          자동 분석 활성화
        </label>
      </div>
      <button className="save-btn" onClick={handleSave}>저장</button>
    </div>
  );
}
