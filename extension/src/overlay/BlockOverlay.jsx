/**
 * BlockOverlay React 컴포넌트
 *
 * [참고] 이 컴포넌트는 Popup UI에서 위험 코드 상세 보기에 사용됩니다.
 * 실제 웹 페이지의 코드 블록 블러/차단은 content/overlay.js에서
 * 순수 DOM 조작으로 처리합니다.
 */

import React from 'react';

export default function BlockOverlay({ category, reason, onAllow, onBlock }) {
  return (
    <div className="asm-block-overlay">
      <div className="asm-block-overlay__content">
        <h3>⛔ 위험한 코드가 감지되었습니다</h3>
        <p className="asm-block-overlay__category">{category}</p>
        <p className="asm-block-overlay__reason">{reason}</p>
        <div className="asm-block-overlay__actions">
          <button className="btn-block" onClick={onBlock}>차단 유지</button>
          <button className="btn-allow" onClick={onAllow}>무시하고 표시</button>
        </div>
      </div>
    </div>
  );
}
