import React from 'react';

export default function BlockOverlay({ onAllow, onBlock }) {
  return (
    <div className="asm-block-overlay">
      <div className="asm-block-overlay__content">
        <h3>⛔ 위험한 코드가 감지되었습니다</h3>
        <p>이 코드를 실행하면 시스템에 손상을 줄 수 있습니다.</p>
        <div className="asm-block-overlay__actions">
          <button className="btn-block" onClick={onBlock}>차단 유지</button>
          <button className="btn-allow" onClick={onAllow}>무시하고 표시</button>
        </div>
      </div>
    </div>
  );
}
