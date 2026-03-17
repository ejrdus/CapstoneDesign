import React from 'react';

const BADGE_CONFIG = {
  safe: { label: '안전', color: '#10b981' },
  caution: { label: '주의', color: '#f59e0b' },
  danger: { label: '위험', color: '#ef4444' },
  unknown: { label: '알 수 없음', color: '#6b7280' },
};

export default function RiskBadge({ level }) {
  const config = BADGE_CONFIG[level] || BADGE_CONFIG.unknown;

  return (
    <span className="risk-badge" style={{ background: config.color }}>
      {config.label}
    </span>
  );
}
