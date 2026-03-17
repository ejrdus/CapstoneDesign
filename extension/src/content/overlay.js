/**
 * 위험 코드 발견 시 경고 오버레이를 표시하는 모듈
 */

/**
 * 코드 블록 위에 경고 배너를 표시
 * @param {HTMLElement} codeElement - 코드 블록 DOM 요소
 * @param {Object} analysisResult - LLM 분석 결과
 */
export function showWarningOverlay(codeElement, analysisResult) {
  const { riskLevel, category, reason } = analysisResult;

  // 이미 오버레이가 있으면 무시
  if (codeElement.parentElement.querySelector('.asm-warning-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'asm-warning-overlay';
  overlay.setAttribute('data-risk', riskLevel);

  const colors = {
    safe: '#10b981',
    caution: '#f59e0b',
    danger: '#ef4444',
  };

  overlay.innerHTML = `
    <div style="
      padding: 10px 14px;
      background: ${colors[riskLevel] || colors.caution};
      color: white;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      border-radius: 6px 6px 0 0;
      display: flex;
      align-items: center;
      gap: 8px;
    ">
      <span style="font-weight: 600;">
        ${riskLevel === 'danger' ? '⛔ 위험' : riskLevel === 'caution' ? '⚠️ 주의' : '✅ 안전'}
      </span>
      <span>${category}: ${reason}</span>
      ${riskLevel === 'danger' ? '<button class="asm-block-btn" style="margin-left:auto;background:white;color:#ef4444;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-weight:600;">차단</button>' : ''}
    </div>
  `;

  codeElement.parentElement.insertBefore(overlay, codeElement);

  // 위험 코드 차단 버튼
  const blockBtn = overlay.querySelector('.asm-block-btn');
  if (blockBtn) {
    blockBtn.addEventListener('click', () => {
      codeElement.style.display = 'none';
      blockBtn.textContent = '차단됨';
      blockBtn.disabled = true;
    });
  }
}

/**
 * 모든 경고 오버레이를 제거
 */
export function clearOverlays() {
  document.querySelectorAll('.asm-warning-overlay').forEach((el) => el.remove());
}
