import React from 'react';

const BADGE_CONFIG = {
  safe: { label: '안전', className: 'safe' },
  caution: { label: '주의', className: 'caution' },
  danger: { label: '위험', className: 'danger' },
  unknown: { label: '알 수 없음', className: 'unknown' },
};

export default function RiskBadge({ level }) {
  const config = BADGE_CONFIG[level] || BADGE_CONFIG.unknown;

  return (
    <span className={`risk-badge ${config.className}`}>
      {config.label}
    </span>
  );
}
