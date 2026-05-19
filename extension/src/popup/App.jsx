import React, { useState, useEffect } from 'react';
import AnalysisStatus from './components/AnalysisStatus';
import CodePreview from './components/CodePreview';
import Settings from './components/Settings';
import ConsentScreen from './components/ConsentScreen';

export default function App() {
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('status');
  const [consentGiven, setConsentGiven] = useState(null); // null = loading

  useEffect(() => {
    chrome.storage.local.get(['analysisHistory', 'userConsent'], (data) => {
      setHistory(data.analysisHistory || []);
      setConsentGiven(data.userConsent === true);
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.analysisHistory) {
        setHistory(changes.analysisHistory.newValue || []);
      }
    });
  }, []);

  function handleAcceptConsent() {
    chrome.storage.local.set({ userConsent: true });
    setConsentGiven(true);
  }

  // 로딩 중
  if (consentGiven === null) return null;

  // 동의 전
  if (!consentGiven) {
    return (
      <div className="app">
        <ConsentScreen onAccept={handleAcceptConsent} />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          <span className="header-logo">🛡️</span>
          <h1>AI Script Monitor</h1>
          <span className="header-badge">v1.0</span>
        </div>
        <nav className="tab-nav">
          <button
            className={activeTab === 'status' ? 'active' : ''}
            onClick={() => setActiveTab('status')}
          >분석 현황</button>
          <button
            className={activeTab === 'settings' ? 'active' : ''}
            onClick={() => setActiveTab('settings')}
          >설정</button>
        </nav>
      </header>

      <main>
        {activeTab === 'status' && (
          <>
            <AnalysisStatus history={history} />
            {history.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🔍</div>
                <div className="empty-title">분석 기록이 없습니다</div>
                <div className="empty-desc">AI 서비스에서 코드가 감지되면 자동으로 분석됩니다</div>
              </div>
            ) : (
              history.map((item, i) => (
                <CodePreview key={i} analysis={item} />
              ))
            )}
          </>
        )}
        {activeTab === 'settings' && <Settings />}
      </main>
    </div>
  );
}
