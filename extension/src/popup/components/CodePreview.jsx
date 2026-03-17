import React, { useState } from 'react';
import RiskBadge from './RiskBadge';

export default function CodePreview({ analysis }) {
  const [expanded, setExpanded] = useState(false);
  const { riskLevel, category, reason, language, timestamp } = analysis;

  return (
    <div className={`code-preview ${riskLevel}`}>
      <div className="code-preview-header" onClick={() => setExpanded(!expanded)}>
        <RiskBadge level={riskLevel} />
        <span className="code-language">{language}</span>
        <span className="code-category">{category}</span>
        <span className="code-time">
          {new Date(timestamp).toLocaleTimeString('ko-KR')}
        </span>
      </div>
      {expanded && (
        <div className="code-preview-body">
          <p className="code-reason">{reason}</p>
        </div>
      )}
    </div>
  );
}
