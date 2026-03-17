import React from 'react';

export default function WarningBanner({ riskLevel, category, reason }) {
  return (
    <div className={`asm-banner asm-banner--${riskLevel}`}>
      <span className="asm-banner__icon">
        {riskLevel === 'danger' ? '⛔' : '⚠️'}
      </span>
      <div className="asm-banner__content">
        <strong>{category}</strong>
        <p>{reason}</p>
      </div>
    </div>
  );
}
