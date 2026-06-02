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

  // 분석 중에도 부모 컨테이너의 액션 버튼 숨김
  blockParentContainer(msgEl);

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

  // 안전 판정 → 부모 컨테이너의 액션 버튼 복원
  unblockParentContainer(msgEl);

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
 * 메시지 위험 표시 — 블러 유지 + 경고 배너 + 액션 버튼 차단
 */
export function markMessageDanger(msgEl, msgId, summary) {
  msgEl.setAttribute('data-asm-blur', 'danger');
  msgEl.classList.remove('asm-blur-pending');
  msgEl.classList.add('asm-blur-danger');
  msgEl.style.setProperty('filter', 'blur(10px)', 'important');
  msgEl.style.setProperty('user-select', 'none', 'important');
  msgEl.style.setProperty('pointer-events', 'none', 'important');

  // 부모 컨테이너(article/turn)에 차단 마커 → CSS로 복사/공유/수정 버튼 숨김
  blockParentContainer(msgEl);

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
        <span class="asm-blocked-label">🚫 이 응답은 보안 위협으로 인해 차단되었습니다</span>
      </div>
    `);
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

  // 분석 중에 액션 버튼 숨김
  blockParentContainer(blurTarget);

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
      handleCaution(blurTarget, blockId, category, reason, threats, details, result.redactionCount || 0);
      break;
    case 'danger':
      handleDanger(blurTarget, blockId, category, reason, threats, details, result.redactionCount || 0);
      break;
    default:
      // unknown / error → fail-closed: 자동 노출하지 않고 사용자 확인을 요구한다.
      // (서버 다운/타임아웃 시 미검증 코드를 그대로 보여주면 보안 도구의 의미가 없음)
      handleError(blurTarget, blockId, reason);
      break;
  }
}

// ─── unknown/error: 분석 실패 → fail-closed (블러 유지 + 직접 확인 버튼) ───

function handleError(blurTarget, blockId, reason) {
  // 분석에 실패해도 코드를 자동으로 노출하지 않는다. 블러를 유지하고,
  // 사용자가 위험을 감수하고 직접 "확인하고 보기"를 눌렀을 때만 해제한다.
  blurTarget.setAttribute('data-asm-blur', 'pending');
  blurTarget.classList.add('asm-blur-pending');
  blockParentContainer(blurTarget);

  const banner = document.createElement('div');
  banner.className = 'asm-result-banner asm-result-caution';
  banner.setAttribute('data-asm-banner', blockId);
  setSafeHTML(banner, `
    <div class="asm-banner-inner">
      <span class="asm-banner-icon">❓</span>
      <div class="asm-banner-detail">
        <strong>분석 실패</strong> — ${escapeHtml(reason || '보안 분석을 완료하지 못했습니다.')} 안전을 확인하지 못해 코드를 가린 상태로 둡니다.
      </div>
      <button class="asm-reveal-btn asm-dismiss-btn" title="직접 확인 후 표시">확인하고 보기</button>
    </div>
  `);

  if (!safeInsertBefore(banner, blurTarget)) {
    // 배너 삽입에 실패해도 자동 노출하지 않고 블러만 유지
    blockStates.set(blockId, { ...(blockStates.get(blockId) || {}), state: 'error', blurTarget, overlay: null });
    return;
  }

  const revealBtn = banner.querySelector('.asm-reveal-btn');
  if (revealBtn) {
    revealBtn.addEventListener('click', () => {
      removeBlur(blurTarget);
      unblockParentContainer(blurTarget);
      banner.classList.add('asm-fade-out');
      setTimeout(() => { if (banner.parentElement) banner.remove(); }, 300);
    });
  }

  blockStates.set(blockId, { state: 'error', blurTarget, overlay: banner });
}

// ─── safe: 블러 해제 + 안전 뱃지 ────────────────────────────

function handleSafe(blurTarget, blockId, category, reason) {
  removeBlur(blurTarget);
  unblockParentContainer(blurTarget);

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

function handleCaution(blurTarget, blockId, category, reason, threats, details, redactionCount) {
  // caution은 블러 없이 경고 배너만 표시 (코드는 볼 수 있음)
  removeBlur(blurTarget);
  unblockParentContainer(blurTarget);

  const intent = (details && details.intent) || '';
  const confidence = details && typeof details.confidence === 'number' ? details.confidence : null;
  const confidenceHtml = confidence !== null
    ? `<span class="asm-confidence-badge asm-confidence-caution">${Math.round(confidence * 100)}%</span>`
    : '';

  const banner = document.createElement('div');
  banner.className = 'asm-result-banner asm-result-caution';
  banner.setAttribute('data-asm-banner', blockId);
  setSafeHTML(banner, `
    <div class="asm-banner-inner">
      <span class="asm-banner-icon">⚠️</span>
      <div class="asm-banner-detail">
        <div class="asm-banner-title-row">
          <strong>주의가 필요한 코드입니다</strong> — ${escapeHtml(category)}
          ${confidenceHtml}
        </div>
        ${intent ? `<p class="asm-banner-intent">${escapeHtml(intent)}</p>` : ''}
        <p class="asm-banner-reason">${escapeHtml(reason)}</p>
      </div>
      <button class="asm-dismiss-btn" title="닫기">✕</button>
    </div>
  `);

  // 배너 닫기 버튼
  const inserted = safeInsertBefore(banner, blurTarget);
  if (!inserted) return;
  const dismissBtn = banner.querySelector('.asm-dismiss-btn');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      banner.classList.add('asm-fade-out');
      setTimeout(() => { if (banner.parentElement) banner.remove(); }, 300);
    });
  }
  blockStates.set(blockId, { state: 'caution', blurTarget, overlay: banner });
}

/**
 * 주의(caution) 차단 블록들을 해제 — 후속 분석에서 안전 판정 후 호출
 */
export function releaseCautionBlocks() {
  for (const [blockId, bs] of blockStates.entries()) {
    if (bs.state !== 'caution-blocked') continue;

    const { blurTarget, overlay } = bs;

    // 블러 해제
    removeBlur(blurTarget);
    blurTarget.classList.remove('asm-blur-caution');

    // 배너를 경고로 전환
    if (overlay && overlay.parentElement) {
      setSafeHTML(overlay, `
        <div class="asm-banner-inner">
          <span class="asm-banner-icon">⚠️</span>
          <div class="asm-banner-detail">
            <strong>주의</strong> — 후속 대화 분석 결과 위험하지 않은 것으로 판단되어 차단이 해제되었습니다.
          </div>
          <button class="asm-dismiss-btn" title="닫기">✕</button>
        </div>
      `);
      const dismissBtn = overlay.querySelector('.asm-dismiss-btn');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
          overlay.classList.add('asm-fade-out');
          setTimeout(() => { if (overlay.parentElement) overlay.remove(); }, 300);
        });
      }
    }

    blockStates.set(blockId, { ...bs, state: 'caution-released' });
  }
}

// ─── danger: 블러 유지 + 차단 오버레이 + 확인 버튼 ───────────

function handleDanger(blurTarget, blockId, category, reason, threats, details, redactionCount) {
  // 블러 유지! pending → danger 로 전환
  blurTarget.setAttribute('data-asm-blur', 'danger');
  blurTarget.classList.remove('asm-blur-pending');
  blurTarget.classList.add('asm-blur-danger');

  // 부모 컨테이너의 복사/공유/수정 버튼 차단
  blockParentContainer(blurTarget);

  const intent = (details && details.intent) || '';
  const confidence = details && typeof details.confidence === 'number' ? details.confidence : null;
  const confidenceHtml = confidence !== null
    ? `<span class="asm-confidence-badge asm-confidence-danger">${Math.round(confidence * 100)}%</span>`
    : '';

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
      </div>
    </div>
    <div class="asm-danger-actions">
      <span class="asm-blocked-label">🚫 이 코드는 보안 위협으로 인해 영구 차단되었습니다</span>
    </div>
  `);

  if (!safeInsertBefore(overlay, blurTarget)) return;
  blurTarget.style.display = 'none';
  blockStates.set(blockId, { state: 'blocked', blurTarget, overlay });
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
 * "원본 보기 / 마스킹 보기" 토글 추가 — 매핑이 클라이언트에 저장돼 있을 때만.
 * 토글 클릭 시 service-worker에 DEANONYMIZE_RESULT 요청, 응답으로 받은 복원된
 * 텍스트로 reason/intent/evidence 영역을 업데이트.
 */
function addDeanonymizeToggle(container, blockId, originalResult) {
  const count = originalResult && originalResult.redactionCount;
  if (!count || count <= 0) return;

  const titleRow = container.querySelector('.asm-banner-title-row');
  if (!titleRow) return;

  const btn = document.createElement('button');
  btn.className = 'asm-deanon-toggle';
  btn.setAttribute('data-asm-state', 'masked');
  btn.textContent = `🔓 원본 보기 (${count}건)`;
  titleRow.appendChild(btn);

  let restoredResult = null;

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const state = btn.getAttribute('data-asm-state');

    if (state === 'masked') {
      if (!restoredResult) {
        try {
          const resp = await chrome.runtime.sendMessage({
            type: 'DEANONYMIZE_RESULT',
            payload: { blockId, result: originalResult },
          });
          if (!resp || !resp.restored) {
            btn.textContent = '⚠️ 매핑 만료';
            btn.disabled = true;
            return;
          }
          restoredResult = resp.result;
        } catch (err) {
          console.warn('[AI Script Monitor] de-anonymize 실패', err);
          return;
        }
      }
      renderBannerDetail(container, restoredResult);
      btn.textContent = '🔒 마스킹 보기';
      btn.setAttribute('data-asm-state', 'restored');
    } else {
      renderBannerDetail(container, originalResult);
      btn.textContent = `🔓 원본 보기 (${count}건)`;
      btn.setAttribute('data-asm-state', 'masked');
    }
  });
}

/**
 * 배너 내부의 텍스트 영역(reason/intent/evidence)을 결과 객체로 다시 채운다.
 * 토글 클릭 시 호출.
 */
function renderBannerDetail(container, result) {
  if (!result) return;

  const reasonEl = container.querySelector('.asm-banner-reason');
  if (reasonEl && result.reason) {
    reasonEl.textContent = result.reason;
  }

  // intent — caution은 .asm-banner-intent (p), danger는 .asm-intent-text (span)
  const intentText = result.details && result.details.intent;
  if (intentText) {
    const cautionIntent = container.querySelector('.asm-banner-intent');
    const dangerIntent = container.querySelector('.asm-intent-text');
    if (cautionIntent) cautionIntent.textContent = intentText;
    if (dangerIntent) dangerIntent.textContent = intentText;
  }

  // evidence — section을 통째로 교체하고 토글 이벤트 재바인딩
  const oldSection = container.querySelector('.asm-evidence-section');
  if (oldSection) {
    const threats = (result.details && result.details.threats) || [];
    const newHtml = buildEvidenceHtml(threats);
    const temp = document.createElement('div');
    setSafeHTML(temp, newHtml);
    const newSection = temp.querySelector('.asm-evidence-section');
    if (newSection) {
      oldSection.replaceWith(newSection);
      setupEvidenceToggle(container);
    }
  }
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
 * 위험 차단 시 부모 컨테이너의 액션 버튼(복사/공유/수정) 숨김 + 클립보드 차단
 *
 * ChatGPT는 스트리밍 완료 후에 액션 버튼을 추가하므로, 블러 시점에 버튼이
 * 아직 DOM에 없을 수 있다. 따라서 document 레벨 MutationObserver로
 * 지속적으로 감시하여 새 버튼이 나타나면 즉시 숨긴다.
 */

// 차단된 컨테이너 추적
const blockedContainers = new Set();
let _globalBtnObserver = null;

function blockParentContainer(el) {
  const container = findTurnContainer(el);
  if (!container) return;

  // 이미 처리된 컨테이너면 버튼 숨김만 재실행
  if (container.getAttribute('data-asm-blocked') === 'true') {
    hideActionButtons(container);
    return;
  }

  container.setAttribute('data-asm-blocked', 'true');
  blockedContainers.add(container);

  // 즉시 숨김
  hideActionButtons(container);

  // 클립보드 복사 이벤트 차단
  container.addEventListener('copy', blockCopyHandler, true);
  container.addEventListener('cut', blockCopyHandler, true);
  container.addEventListener('keydown', blockCopyKeyHandler, true);

  // document 레벨 글로벌 옵저버 시작 (한 번만)
  startGlobalButtonObserver();
}

/**
 * 메시지를 감싸는 최상위 턴 컨테이너를 찾는다.
 * ChatGPT의 article, Claude/Gemini의 메시지 래퍼 등.
 */
function findTurnContainer(el) {
  // 1. 구체적 셀렉터로 탐색
  const specific = el.closest([
    'article[data-testid^="conversation-turn"]',  // ChatGPT
    'article',                                     // ChatGPT fallback
    '.font-claude-message',                        // Claude
    'model-response',                              // Gemini
    '.response-container-content',                 // Gemini
  ].join(', '));
  if (specific) return specific;

  // 2. fallback: 부모를 6단계까지 올라감
  let target = el;
  for (let i = 0; i < 6 && target.parentElement; i++) {
    target = target.parentElement;
  }
  return target;
}

/**
 * document 레벨 MutationObserver — DOM 변경 시 차단 컨테이너 내 버튼을 숨김.
 * ChatGPT가 스트리밍 완료 후 나중에 버튼을 추가해도 잡아냄.
 */
function startGlobalButtonObserver() {
  if (_globalBtnObserver) return; // 이미 시작됨

  _globalBtnObserver = new MutationObserver(() => {
    for (const container of blockedContainers) {
      // 컨테이너가 DOM에서 제거됐으면 Set에서도 삭제
      if (!container.isConnected) {
        blockedContainers.delete(container);
        continue;
      }
      if (container.getAttribute('data-asm-blocked') === 'true') {
        hideActionButtons(container);
      }
    }
    // 차단 컨테이너가 없으면 옵저버 중지
    if (blockedContainers.size === 0) {
      _globalBtnObserver.disconnect();
      _globalBtnObserver = null;
    }
  });

  _globalBtnObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * 컨테이너 내 AI 서비스 액션 버튼(복사/공유/수정/좋아요 등)을 직접 숨김
 * 우리 배너(asm-) 내부 버튼은 제외
 */
function hideActionButtons(container) {
  const buttons = container.querySelectorAll('button, [role="button"]');
  for (const btn of buttons) {
    // 우리 확장 프로그램의 버튼은 스킵
    if (btn.className && btn.className.includes && btn.className.includes('asm-')) continue;
    if (btn.closest && btn.closest('[data-asm-banner], [data-asm-msg-banner], .asm-result-banner')) continue;
    // 이미 숨겨진 버튼은 스킵
    if (btn.style.display === 'none') continue;
    btn.style.setProperty('display', 'none', 'important');
    btn.style.setProperty('pointer-events', 'none', 'important');
  }
}

/**
 * 안전 판정 시 부모 컨테이너의 차단 해제 — 숨긴 버튼 복원 + 이벤트 핸들러 제거
 */
function unblockParentContainer(el) {
  const container = el.closest('[data-asm-blocked="true"]');
  if (!container) return;

  container.removeAttribute('data-asm-blocked');
  blockedContainers.delete(container);

  // 숨겼던 버튼 복원
  const buttons = container.querySelectorAll('button, [role="button"]');
  for (const btn of buttons) {
    if (btn.className && btn.className.includes && btn.className.includes('asm-')) continue;
    btn.style.removeProperty('display');
    btn.style.removeProperty('pointer-events');
  }

  // 이벤트 핸들러 제거
  container.removeEventListener('copy', blockCopyHandler, true);
  container.removeEventListener('cut', blockCopyHandler, true);
  container.removeEventListener('keydown', blockCopyKeyHandler, true);
}

function blockCopyHandler(e) {
  e.preventDefault();
  e.stopPropagation();
}

function blockCopyKeyHandler(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault();
    e.stopPropagation();
  }
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
