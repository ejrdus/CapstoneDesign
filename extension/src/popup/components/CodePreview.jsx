import React, { useState } from 'react';
import RiskBadge from './RiskBadge';

// 언어 표시명 매핑
const LANG_NAMES = {
  python: 'Python', bash: 'Bash', javascript: 'JavaScript', typescript: 'TypeScript',
  powershell: 'PowerShell', java: 'Java', c: 'C', cpp: 'C++', go: 'Go',
  ruby: 'Ruby', php: 'PHP', rust: 'Rust', csharp: 'C#', sql: 'SQL',
  html: 'HTML', css: 'CSS', unknown: 'Unknown',
};

// AI 서비스 클래스 매핑
function getServiceClass(service) {
  if (!service) return '';
  const s = service.toLowerCase();
  if (s.includes('chatgpt')) return 'chatgpt';
  if (s.includes('claude')) return 'claude';
  if (s.includes('gemini')) return 'gemini';
  return '';
}

export default function CodePreview({ analysis }) {
  const [expanded, setExpanded] = useState(false);
  const { riskLevel, category, reason, language, timestamp, aiService } = analysis;

  const langDisplay = LANG_NAMES[language] || language || 'Unknown';
  const serviceClass = getServiceClass(aiService);

  return (
    <div className={`code-preview ${riskLevel}`}>
      <div className="code-preview-header" onClick={() => setExpanded(!expanded)}>
        <RiskBadge level={riskLevel} />
        {aiService && (
          <span className={`ai-service-badge ${serviceClass}`}>
            {aiService}
          </span>
        )}
        <span className="code-language">{langDisplay}</span>
        <span className="code-category">{category}</span>
        <span className="code-time">
          {new Date(timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
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
