import React from 'react';

export default function AnalysisStatus({ history }) {
  const total = history.length;
  const dangers = history.filter((h) => h.riskLevel === 'danger').length;
  const cautions = history.filter((h) => h.riskLevel === 'caution').length;
  const safes = history.filter((h) => h.riskLevel === 'safe').length;

  return (
    <div className="analysis-status">
      <div className="status-card">
        <span className="status-number">{total}</span>
        <span className="status-label">분석 완료</span>
      </div>
      <div className="status-card danger">
        <span className="status-number">{dangers}</span>
        <span className="status-label">위험</span>
      </div>
      <div className="status-card caution">
        <span className="status-number">{cautions}</span>
        <span className="status-label">주의</span>
      </div>
      <div className="status-card safe">
        <span className="status-number">{safes}</span>
        <span className="status-label">안전</span>
      </div>
    </div>
  );
}
