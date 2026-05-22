import React, { useState, useEffect, useMemo } from 'react';
import AnalysisStatus from './components/AnalysisStatus';
import CodePreview from './components/CodePreview';
import Settings from './components/Settings';
import ConsentScreen from './components/ConsentScreen';
import ThreatChart from './components/ThreatChart';

const THEME_STORAGE_KEY = 'asmTheme';
const DEFAULT_THEME = 'dark';

function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
}

export default function App() {
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('status');
  const [consentGiven, setConsentGiven] = useState(null); // null = loading
  const [query, setQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState('all'); // all | danger | caution | safe

  useEffect(() => {
    chrome.storage.local.get(['analysisHistory', 'userConsent', THEME_STORAGE_KEY], (data) => {
      setHistory(data.analysisHistory || []);
      setConsentGiven(data.userConsent === true);
      applyTheme(data[THEME_STORAGE_KEY] || DEFAULT_THEME);
    });
    const listener = (changes) => {
      if (changes.analysisHistory) {
        setHistory(changes.analysisHistory.newValue || []);
      }
      if (changes[THEME_STORAGE_KEY]) {
        applyTheme(changes[THEME_STORAGE_KEY].newValue || DEFAULT_THEME);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  function handleAcceptConsent() {
    chrome.storage.local.set({ userConsent: true });
    setConsentGiven(true);
  }

  // 검색·필터 적용
  const visibleHistory = useMemo(() => {
    const q = query.trim().toLowerCase();
    return history.filter((item) => {
      if (riskFilter !== 'all' && item.riskLevel !== riskFilter) return false;
      if (!q) return true;
      const haystack = [
        item.category,
        item.reason,
        item.language,
        item.aiService,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [history, query, riskFilter]);

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
            <ThreatChart history={history} />

            {history.length > 0 && (
              <div className="history-toolbar">
                <input
                  type="text"
                  className="history-search"
                  placeholder="🔍 카테고리/사유/언어/서비스로 검색"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="filter-chips">
                  {['all', 'danger', 'caution', 'safe'].map((level) => (
                    <button
                      key={level}
                      className={`filter-chip ${level} ${riskFilter === level ? 'active' : ''}`}
                      onClick={() => setRiskFilter(level)}
                    >
                      {level === 'all' ? '전체' : level === 'danger' ? '위험' : level === 'caution' ? '주의' : '안전'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {history.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🔍</div>
                <div className="empty-title">분석 기록이 없습니다</div>
                <div className="empty-desc">AI 서비스에서 코드가 감지되면 자동으로 분석됩니다</div>
              </div>
            ) : visibleHistory.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🪄</div>
                <div className="empty-title">검색 결과 없음</div>
                <div className="empty-desc">검색어/필터를 조정해 보세요</div>
              </div>
            ) : (
              visibleHistory.map((item, i) => (
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
