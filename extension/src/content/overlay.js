/**
 * 코드 블록 오버레이 관리 모듈
 *
 * [3단계 상태 관리 - Blur-First 전략]
 *
 * 상태 1: PENDING (감지 직후)
 *   - 코드 블록에 블러 + 복사 방지 즉시 적용
 *   - "분석 중..." 스캐닝 배너 표시
 *
 * 상태 2: RESULT (분석 완료)
 *   - safe    → 블러 해제 + 초록 "안전" 뱃지 (2초 후 자동 제거)
 *   - caution → 블러 해제 + 노란 경고 배너 유지
 *   - danger  → 블러 유지 + 빨간 차단 오버레이 + 사용자 확인 버튼
 *
 * [Trusted Types CSP 대응]
 * ChatGPT 등 일부 사이트는 Trusted Types CSP를 강제하여 innerHTML 직접 할당을
 * 차단함. 이를 우회하기 위해 자체 policy를 등록하고, innerHTML 대신 setSafeHTML
 * 헬퍼를 사용한다. policy는 우리가 만든 HTML 문자열에만 적용되므로 안전하다.
 * (사용자 입력은 escapeHtml로 이미 sanitize 처리되어 있음)
 */

// Trusted Types policy — Trusted Types를 강제하는 사이트(ChatGPT)에서 innerHTML이
// 막히는 문제를 해결한다. 정책을 등록하지 못하는 환경에서는 정상적인 문자열을
// 그대로 사용한다.
let _asmTrustedHTMLPolicy = null;
try {
  if (typeof window !== 'undefined' && window.trustedTypes && window.trustedTypes.createPolicy) {
    _asmTrustedHTMLPolicy = window.trustedTypes.createPolicy('asm-overlay', {
      createHTML: (input) => input,
    });
  }
} catch (e) {
  // 동일 이름의 policy가 이미 존재하거나 Trusted Types가 비활성화된 경우 무시
  console.warn('[AI Script Monitor] Trusted Types policy 등록 실패, fallback 사용:', e);
  _asmTrustedHTMLPolicy = null;
}

/**
 * innerHTML을 안전하게 할당 — Trusted Types CSP가 켜진 사이트에서도 동작
 */
function setSafeHTML(element, htmlString) {
  if (_asmTrustedHTMLPolicy) {
    element.innerHTML = _asmTrustedHTMLPolicy.createHTML(htmlString);
  } else {
    element.innerHTML = htmlString;
  }
}

/**
 * insertBefore를 race-safe하게 호출.
 * referenceNode의 parentNode가 사라졌거나 referenceNode가 더 이상 그 부모의 자식이
 * 아닌 경우(React가 DOM을 갈아치우는 동안 발생) 안전하게 false 반환.
 *
 * @param {Node} newNode - 삽입할 노드
 * @param {Node} referenceNode - 그 앞에 삽입할 기준 노드
 * @returns {boolean} 삽입 성공 여부
 */
function safeInsertBefore(newNode, referenceNode) {
  if (!referenceNode) return false;
  const parent = referenceNode.parentNode;
  if (!parent) return false;
  // race 확인 — referenceNode가 여전히 parent의 자식인가
  if (referenceNode.parentNode !== parent) return false;
  try {
    parent.insertBefore(newNode, referenceNode);
    return true;
  } catch (e) {
    // DOM race로 인한 예외는 조용히 무시 — 다음 mutation에서 재시도됨
    return false;
  }
}

// 블록별 상태 추적
const blockStates = new Map();
// 메시지별 상태 추적 (assistant 메시지 전체 블러)
const messageStates = new Map();

// ─── 메시지 단위 블러 ────────────────────────────────────────

/**
 * Assistant 메시지 전체를 블러 처리
 */
/**
 * 강제로 inline style을 고정 — React 재조정에 대비해 mutation observer로 감시,
 * 누군가 style/data-asm-blur를 건드리면 즉시 재적용.
 */
function enforceBlurStyle(msgEl, level) {
  const blurPx = level === 'danger' ? '10px' : '8px';
  msgEl.setAttribute('data-asm-blur', level);
  msgEl.style.setProperty('filter', `blur(${blurPx})`, 'important');
  msgEl.style.setProperty('user-select', 'none', 'important');
  msgEl.style.setProperty('pointer-events', 'none', 'important');
  msgEl.style.setProperty('transition', 'filter 0.3s ease', 'important');
}

export function applyMessageBlur(msgEl, msgId) {
  // 멱등성: 이미 처리된 메시지면 배너 중복 삽입 금지, blur만 재확인
  const existing = messageStates.get(msgId);
  if (existing && existing.element === msgEl && existing.banner && existing.banner.parentElement) {
    enforceBlurStyle(msgEl, existing.state === 'danger' ? 'danger' : 'pending');
    return;
  }

  enforceBlurStyle(msgEl, 'pending');
  msgEl.classList.add('asm-blur-pending');

  // 가드 옵저버 — React가 우리 inline style이나 data-asm-blur를 wipe하면 즉시 복구
  let guardObserver = null;
  if (typeof MutationObserver !== 'undefined') {
    guardObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'style' || m.attributeName === 'data-asm-blur') {
          const state = messageStates.get(msgId);
          if (!state || state.state === 'revealed') {
            guardObserver.disconnect();
            return;
          }
          // 누군가 wipe했으면 다시 박아넣기
          if (msgEl.getAttribute('data-asm-blur') !== state.state || !msgEl.style.filter) {
            enforceBlurStyle(msgEl, state.state === 'danger' ? 'danger' : 'pending');
          }
        }
      }
    });
    guardObserver.observe(msgEl, { attributes: true, attributeFilter: ['style', 'data-asm-blur'] });
  }

  // 메시지 위에 "분석 중" 배너 삽입 (한 메시지당 1개만)
  let banner = null;
  const parent = msgEl.parentElement;
  if (parent) {
    // 이미 같은 msgId용 배너가 있으면 재사용
    const dup = parent.querySelector(`[data-asm-msg-banner="${msgId}"]`);
    if (dup) {
      banner = dup;
    } else {
      const newBanner = document.createElement('div');
      newBanner.className = 'asm-result-banner asm-scanning';
      newBanner.setAttribute('data-asm-msg-banner', msgId);
      setSafeHTML(newBanner, `
        <div class="asm-banner-inner">
          <span class="asm-spinner"></span>
          <span class="asm-banner-text">AI 응답 보안 분석 중...</span>
        </div>
      `);
      if (safeInsertBefore(newBanner, msgEl)) {
        banner = newBanner;
      }
    }
  }

  messageStates.set(msgId, { element: msgEl, banner, guardObserver, state: 'pending' });
}

/**
 * 메시지 블러 해제 (안전 판정 또는 분석 완료)
 */
export function removeMessageBlur(msgEl, msgId) {
  const state = messageStates.get(msgId);
  // 가드 옵저버 먼저 끊기 — 그래야 style을 지워도 다시 박지 않음
  if (state && state.guardObserver) {
    state.guardObserver.disconnect();
  }
  // 새 상태를 먼저 기록 (가드 옵저버가 race로 살아있어도 'revealed'를 보고 종료)
  messageStates.set(msgId, { ...(state || {}), state: 'revealed', guardObserver: null });

  msgEl.removeAttribute('data-asm-blur');
  msgEl.classList.remove('asm-blur-pending', 'asm-blur-danger');
  msgEl.style.removeProperty('filter');
  msgEl.style.removeProperty('user-select');
  msgEl.style.removeProperty('pointer-events');
  msgEl.style.removeProperty('transition');
  msgEl.setAttribute('data-asm-msg-state', 'revealed');

  // "분석 중" 배너 제거 (안전 배너는 코드 블록 레벨에서 표시)
  const banner = state && state.banner && state.banner.parentElement ? state.banner : null;
  if (banner) {
    banner.classList.add('asm-fade-out');
    setTimeout(() => {
      if (banner.parentElement) banner.remove();
    }, 500);
  }
}

/**
 * 메시지 위험 표시 — 블러 유지 + 경고 배너
 */
export function markMessageDanger(msgEl, msgId, summary) {
  msgEl.setAttribute('data-asm-blur', 'danger');
  msgEl.classList.remove('asm-blur-pending');
  msgEl.classList.add('asm-blur-danger');
  msgEl.style.setProperty('filter', 'blur(10px)', 'important');
  msgEl.style.setProperty('user-select', 'none', 'important');
  msgEl.style.setProperty('pointer-events', 'none', 'important');

  const state = messageStates.get(msgId);
  if (state && state.banner) {
    state.banner.className = 'asm-result-banner asm-result-danger';
    setSafeHTML(state.banner, `
      <div class="asm-banner-inner">
        <span class="asm-banner-icon">⛔</span>
        <div class="asm-banner-detail">
          <strong>위험한 코드가 포함된 응답</strong>
          <p class="asm-banner-reason">${escapeHtml(summary || '응답 내 위험한 코드가 감지되어 차단되었습니다.')}</p>
        </div>
      </div>
      <div class="asm-danger-actions">
        <button class="asm-btn asm-btn-reveal" data-msg-id="${msgId}">무시하고 표시</button>
      </div>
    `);
    const revealBtn = state.banner.querySelector('.asm-btn-reveal');
    if (revealBtn) {
      revealBtn.addEventListener('click', () => {
        removeMessageBlur(msgEl, msgId);
      });
    }
  }
  messageStates.set(msgId, { ...(state || {}), state: 'danger' });
}

// ─── 상태 1: 감지 즉시 블러 적용 ─────────────────────────────

/**
 * 코드 블록 감지 즉시 블러 + 복사 방지 적용
 * codeExtractor에서 코드 블록 발견 시 바로 호출됨
 *
 * @param {HTMLElement} blurTarget - 블러를 적용할 요소 (<pre> 또는 코드 블록)
 * @param {string} blockId - 고유 블록 ID
 */
export function applyPendingBlur(blurTarget, blockId) {
  // 클래스 대신 data 속성으로 블러 상태를 표시 — React가 재렌더링해도
  // 우리가 setAttribute로 넣은 data-* 는 (대개) 보존된다.
  // CSS는 [data-asm-blur="pending"] 셀렉터로 매칭.
  blurTarget.setAttribute('data-asm-blur', 'pending');
  // 클래스도 함께 (구버전 호환)
  blurTarget.classList.add('asm-blur-pending');

  blockStates.set(blockId, {
    state: 'pending',
    blurTarget,
    overlay: null,
  });

  // 메시지 단위 블러 배너가 이미 있으면 블록 배너 생략 (중복 방지)
  const insideMessageBlur = blurTarget.closest && blurTarget.closest('[data-asm-msg-id]');
  if (!insideMessageBlur) {
    const banner = createScanningBanner(blockId);
    if (safeInsertBefore(banner, blurTarget)) {
      blockStates.get(blockId).overlay = banner;
    }
  }
}

// ─── 상태 2: 분석 결과 반영 ──────────────────────────────────

/**
 * 분석 완료 후 결과에 따라 블러 해제/유지 처리
 *
 * @param {string} blockId - 블록 ID
 * @param {Object} result - { riskLevel, category, reason, details }
 */
export function applyAnalysisResult(blockId, result) {
  const blockState = blockStates.get(blockId);
  if (!blockState) return;

  const { blurTarget, overlay } = blockState;
  const { riskLevel, category, reason, details } = result;

  // 기존 스캐닝 배너 제거
  if (overlay && overlay.parentElement) {
    overlay.remove();
  }

  // details에서 위협 증거(evidence) 추출
  const threats = (details && details.threats) || [];

  switch (riskLevel) {
    case 'safe':
      if (result._noBanner) {
        removeBlur(blurTarget);
        blockStates.set(blockId, { state: 'safe', blurTarget, overlay: null });
      } else {
        handleSafe(blurTarget, blockId, category, reason);
      }
      break;
    case 'caution':
      handleCaution(blurTarget, blockId, category, reason, threats, details);
      break;
    case 'danger':
      handleDanger(blurTarget, blockId, category, reason, threats, details);
      break;
    default:
      // unknown / error → 블러 해제하되 경고
      removeBlur(blurTarget);
      blockStates.set(blockId, { ...blockState, state: 'error' });
      break;
  }
}

// ─── safe: 블러 해제 + 안전 뱃지 ────────────────────────────

function handleSafe(blurTarget, blockId, category, reason) {
  removeBlur(blurTarget);

  const badge = document.createElement('div');
  badge.className = 'asm-result-banner asm-result-safe';
  badge.setAttribute('data-asm-banner', blockId);
  setSafeHTML(badge, `
    <div class="asm-banner-inner">
      <span class="asm-banner-icon">✅</span>
      <span class="asm-banner-text"><strong>안전</strong> — 악성 행위가 감지되지 않았습니다.</span>
    </div>
  `);

  if (!safeInsertBefore(badge, blurTarget)) return;
  blockStates.set(blockId, { state: 'safe', blurTarget, overlay: badge });

  // 3초 후 뱃지 자동 페이드아웃
  setTimeout(() => {
    badge.classList.add('asm-fade-out');
    setTimeout(() => {
      if (badge.parentElement) badge.remove();
    }, 500);
  }, 3000);
}

// ─── caution: 블러 해제 + 경고 배너 유지 ─────────────────────

function handleCaution(blurTarget, blockId, category, reason, threats, details) {
  removeBlur(blurTarget);

  const intent = (details && details.intent) || '';
  const confidence = details && typeof details.confidence === 'number' ? details.confidence : null;
  const confidenceHtml = confidence !== null
    ? `<span class="asm-confidence-badge asm-confidence-caution">${Math.round(confidence * 100)}%</span>`
    : '';
  const evidenceHtml = buildEvidenceHtml(threats);

  const banner = document.createElement('div');
  banner.className = 'asm-result-banner asm-result-caution';
  banner.setAttribute('data-asm-banner', blockId);
  setSafeHTML(banner, `
    <div class="asm-banner-inner">
      <span class="asm-banner-icon">⚠️</span>
      <div class="asm-banner-detail">
        <div class="asm-banner-title-row">
          <strong>주의</strong> — ${escapeHtml(category)}
          ${confidenceHtml}
        </div>
        ${intent ? `<p class="asm-banner-intent">${escapeHtml(intent)}</p>` : ''}
        <p class="asm-banner-reason">${escapeHtml(reason)}</p>
        ${evidenceHtml}
      </div>
      <button class="asm-dismiss-btn" title="닫기">✕</button>
    </div>
  `);

  if (!safeInsertBefore(banner, blurTarget)) return;
  blockStates.set(blockId, { state: 'caution', blurTarget, overlay: banner });

  banner.querySelector('.asm-dismiss-btn').addEventListener('click', () => {
    banner.classList.add('asm-fade-out');
    setTimeout(() => { if (banner.parentElement) banner.remove(); }, 300);
  });

  setupEvidenceToggle(banner);
}

// ─── danger: 블러 유지 + 차단 오버레이 + 확인 버튼 ───────────

function handleDanger(blurTarget, blockId, category, reason, threats, details) {
  // 블러 유지! pending → danger 로 전환
  blurTarget.setAttribute('data-asm-blur', 'danger');
  blurTarget.classList.remove('asm-blur-pending');
  blurTarget.classList.add('asm-blur-danger');

  const intent = (details && details.intent) || '';
  const confidence = details && typeof details.confidence === 'number' ? details.confidence : null;
  const confidenceHtml = confidence !== null
    ? `<span class="asm-confidence-badge asm-confidence-danger">${Math.round(confidence * 100)}%</span>`
    : '';
  const evidenceHtml = buildEvidenceHtml(threats);

  const overlay = document.createElement('div');
  overlay.className = 'asm-result-banner asm-result-danger';
  overlay.setAttribute('data-asm-banner', blockId);
  setSafeHTML(overlay, `
    <div class="asm-banner-inner">
      <span class="asm-banner-icon">⛔</span>
      <div class="asm-banner-detail">
        <div class="asm-banner-title-row">
          <strong>위험한 코드가 감지되었습니다</strong> — ${escapeHtml(category)}
          ${confidenceHtml}
        </div>
        ${intent ? `
        <div class="asm-intent-box asm-intent-danger">
          <span class="asm-intent-label">의도</span>
          <span class="asm-intent-text">${escapeHtml(intent)}</span>
        </div>` : ''}
        <p class="asm-banner-reason">${escapeHtml(reason)}</p>
        ${evidenceHtml}
      </div>
    </div>
    <div class="asm-danger-actions">
      <button class="asm-btn asm-btn-block">차단 유지</button>
      <button class="asm-btn asm-btn-reveal">코드 보기 (위험 감수)</button>
    </div>
  `);

  if (!safeInsertBefore(overlay, blurTarget)) return;
  blockStates.set(blockId, { state: 'danger', blurTarget, overlay });

  // 차단 유지 버튼
  overlay.querySelector('.asm-btn-block').addEventListener('click', () => {
    blurTarget.style.display = 'none';
    setSafeHTML(
      overlay.querySelector('.asm-danger-actions'),
      '<span class="asm-blocked-label">🚫 차단됨</span>'
    );
    blockStates.set(blockId, { ...blockStates.get(blockId), state: 'blocked' });
  });

  // 코드 보기 버튼 → 2단계 확인
  overlay.querySelector('.asm-btn-reveal').addEventListener('click', () => {
    const actionsEl = overlay.querySelector('.asm-danger-actions');
    setSafeHTML(actionsEl, `
      <div class="asm-confirm-box">
        <p class="asm-confirm-text">⚠️ 이 코드는 <strong>${escapeHtml(category)}</strong> 위협이 감지된 코드입니다. 정말 표시하시겠습니까?</p>
        <div class="asm-confirm-buttons">
          <button class="asm-btn asm-btn-cancel">취소</button>
          <button class="asm-btn asm-btn-confirm-reveal">네, 표시합니다</button>
        </div>
      </div>
    `);
    actionsEl.querySelector('.asm-btn-cancel').addEventListener('click', () => {
      setSafeHTML(actionsEl, `
        <button class="asm-btn asm-btn-block">차단 유지</button>
        <button class="asm-btn asm-btn-reveal">코드 보기 (위험 감수)</button>
      `);
      // 이벤트 재등록
      rebindDangerActions(overlay, blurTarget, blockId, category);
    });
    actionsEl.querySelector('.asm-btn-confirm-reveal').addEventListener('click', () => {
      removeBlur(blurTarget);
      setSafeHTML(actionsEl, '<span class="asm-revealed-label">⚠️ 사용자가 표시를 허용했습니다</span>');
      blockStates.set(blockId, { ...blockStates.get(blockId), state: 'revealed' });
    });
  });

  setupEvidenceToggle(overlay);
}

/**
 * danger 오버레이 버튼 이벤트 재바인딩 (2단계 확인에서 취소 후)
 */
function rebindDangerActions(overlay, blurTarget, blockId, category) {
  const blockBtn = overlay.querySelector('.asm-btn-block');
  const revealBtn = overlay.querySelector('.asm-btn-reveal');
  if (blockBtn) {
    blockBtn.addEventListener('click', () => {
      blurTarget.style.display = 'none';
      setSafeHTML(
        overlay.querySelector('.asm-danger-actions'),
        '<span class="asm-blocked-label">🚫 차단됨</span>'
      );
      blockStates.set(blockId, { ...blockStates.get(blockId), state: 'blocked' });
    });
  }
  if (revealBtn) {
    revealBtn.addEventListener('click', () => {
      const actionsEl = overlay.querySelector('.asm-danger-actions');
      setSafeHTML(actionsEl, `
        <div class="asm-confirm-box">
          <p class="asm-confirm-text">⚠️ 이 코드는 <strong>${escapeHtml(category)}</strong> 위협이 감지된 코드입니다. 정말 표시하시겠습니까?</p>
          <div class="asm-confirm-buttons">
            <button class="asm-btn asm-btn-cancel">취소</button>
            <button class="asm-btn asm-btn-confirm-reveal">네, 표시합니다</button>
          </div>
        </div>
      `);
      actionsEl.querySelector('.asm-btn-cancel').addEventListener('click', () => {
        setSafeHTML(actionsEl, `
          <button class="asm-btn asm-btn-block">차단 유지</button>
          <button class="asm-btn asm-btn-reveal">코드 보기 (위험 감수)</button>
        `);
        rebindDangerActions(overlay, blurTarget, blockId, category);
      });
      actionsEl.querySelector('.asm-btn-confirm-reveal').addEventListener('click', () => {
        removeBlur(blurTarget);
        setSafeHTML(actionsEl, '<span class="asm-revealed-label">⚠️ 사용자가 표시를 허용했습니다</span>');
        blockStates.set(blockId, { ...blockStates.get(blockId), state: 'revealed' });
      });
    });
  }
}

// ─── 유틸리티 ────────────────────────────────────────────────

/**
 * 위협 증거(evidence)를 HTML로 변환
 * 설명 가능한 분석(Explainable Analysis) — 코드 라인 단위 근거 표시
 *
 * @param {Array} threats - LLM이 반환한 위협 목록
 * @returns {string} HTML 문자열
 */
function buildEvidenceHtml(threats) {
  if (!threats || threats.length === 0) return '';

  const items = threats
    .filter((t) => t.evidence)
    .map((t) => {
      const location = t.lineHint ? `<span class="asm-evidence-location">${escapeHtml(t.lineHint)}</span>` : '';
      return `
        <div class="asm-evidence-item">
          <div class="asm-evidence-header">
            <span class="asm-evidence-type">${escapeHtml(t.category || t.type)}</span>
            ${location}
          </div>
          <code class="asm-evidence-code">${escapeHtml(t.evidence)}</code>
          <p class="asm-evidence-desc">${escapeHtml(t.description)}</p>
        </div>
      `;
    })
    .join('');

  if (!items) return '';

  return `
    <div class="asm-evidence-section">
      <button class="asm-evidence-toggle">위험 근거 상세보기 ▼</button>
      <div class="asm-evidence-list" style="display:none;">
        ${items}
      </div>
    </div>
  `;
}

/**
 * 증거 상세보기 토글 버튼 이벤트 설정
 */
function setupEvidenceToggle(container) {
  const toggleBtn = container.querySelector('.asm-evidence-toggle');
  if (!toggleBtn) return;

  toggleBtn.addEventListener('click', () => {
    const list = container.querySelector('.asm-evidence-list');
    if (!list) return;
    const isHidden = list.style.display === 'none';
    list.style.display = isHidden ? 'block' : 'none';
    toggleBtn.textContent = isHidden ? '위험 근거 접기 ▲' : '위험 근거 상세보기 ▼';
  });
}

/**
 * 블러 효과 제거
 */
function removeBlur(element) {
  element.removeAttribute('data-asm-blur');
  element.classList.remove('asm-blur-pending', 'asm-blur-danger');
}

/**
 * "분석 중..." 스캐닝 배너 생성
 */
function createScanningBanner(blockId) {
  const banner = document.createElement('div');
  banner.className = 'asm-result-banner asm-scanning';
  banner.setAttribute('data-asm-banner', blockId);
  setSafeHTML(banner, `
    <div class="asm-banner-inner">
      <span class="asm-spinner"></span>
      <span class="asm-banner-text">보안 분석 중...</span>
    </div>
  `);
  return banner;
}

/**
 * HTML 이스케이프
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * 모든 오버레이 및 블러를 제거 (페이지 전환 시 정리용)
 */
export function clearAllOverlays() {
  document.querySelectorAll('[data-asm-banner]').forEach((el) => el.remove());
  document.querySelectorAll('.asm-blur-pending, .asm-blur-danger').forEach((el) => {
    removeBlur(el);
  });
  blockStates.clear();
}

/**
 * 특정 블록의 현재 상태 조회
 */
export function getBlockState(blockId) {
  return blockStates.get(blockId);
}
