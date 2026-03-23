/**
 * WarningBanner React 컴포넌트
 *
 * [참고] 이 컴포넌트는 Popup UI에서 주의/위험 항목 표시에 사용됩니다.
 * 실제 웹 페이지의 경고 배너는 content/overlay.js에서
 * 순수 DOM 조작으로 처리합니다.
 */

import React from 'react';

const BANNER_CONFIG = {
  caution: { icon: '⚠️', className: 'asm-banner--caution' },
  danger: { icon: '⛔', className: 'asm-banner--danger' },
};

export default function WarningBanner({ riskLevel, category, reason }) {
  const config = BANNER_CONFIG[riskLevel] || BANNER_CONFIG.caution;

  return (
    <div className={`asm-banner ${config.className}`}>
      <span className="asm-banner__icon">{config.icon}</span>
      <div className="asm-banner__content">
        <strong>{category}</strong>
        <p>{reason}</p>
      </div>
    </div>
  );
}
