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
 */

// 블록별 상태 추적
const blockStates = new Map();

// ─── 상태 1: 감지 즉시 블러 적용 ─────────────────────────────

/**
 * 코드 블록 감지 즉시 블러 + 복사 방지 적용
 * codeExtractor에서 코드 블록 발견 시 바로 호출됨
 *
 * @param {HTMLElement} blurTarget - 블러를 적용할 요소 (<pre> 또는 코드 블록)
 * @param {string} blockId - 고유 블록 ID
 */
export function applyPendingBlur(blurTarget, blockId) {
  // 블러 + 복사/클릭 방지
  blurTarget.classList.add('asm-blur-pending');

  // 상태 저장
  blockStates.set(blockId, {
    state: 'pending',
    blurTarget,
    overlay: null,
  });

  // "분석 중" 배너 삽입
  const banner = createScanningBanner(blockId);
  blurTarget.parentElement.insertBefore(banner, blurTarget);

  blockStates.get(blockId).overlay = banner;
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
      handleSafe(blurTarget, blockId, category, reason);
      break;
    case 'caution':
      handleCaution(blurTarget, blockId, category, reason, threats);
      break;
    case 'danger':
      handleDanger(blurTarget, blockId, category, reason, threats);
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
  badge.innerHTML = `
    <div class="asm-banner-inner">
      <span class="asm-banner-icon">✅</span>
      <span class="asm-banner-text"><strong>안전</strong> — 악성 행위가 감지되지 않았습니다.</span>
    </div>
  `;

  blurTarget.parentElement.insertBefore(badge, blurTarget);
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

function handleCaution(blurTarget, blockId, category, reason, threats) {
  removeBlur(blurTarget);

  const evidenceHtml = buildEvidenceHtml(threats);

  const banner = document.createElement('div');
  banner.className = 'asm-result-banner asm-result-caution';
  banner.setAttribute('data-asm-banner', blockId);
  banner.innerHTML = `
    <div class="asm-banner-inner">
      <span class="asm-banner-icon">⚠️</span>
      <div class="asm-banner-detail">
        <strong>주의</strong> — ${escapeHtml(category)}
        <p class="asm-banner-reason">${escapeHtml(reason)}</p>
        ${evidenceHtml}
      </div>
      <button class="asm-dismiss-btn" title="닫기">✕</button>
    </div>
  `;

  blurTarget.parentElement.insertBefore(banner, blurTarget);
  blockStates.set(blockId, { state: 'caution', blurTarget, overlay: banner });

  // 닫기 버튼
  banner.querySelector('.asm-dismiss-btn').addEventListener('click', () => {
    banner.classList.add('asm-fade-out');
    setTimeout(() => { if (banner.parentElement) banner.remove(); }, 300);
  });

  // 증거 토글 버튼
  setupEvidenceToggle(banner);
}

// ─── danger: 블러 유지 + 차단 오버레이 + 확인 버튼 ───────────

function handleDanger(blurTarget, blockId, category, reason, threats) {
  // 블러 유지! pending → danger 클래스로 전환
  blurTarget.classList.remove('asm-blur-pending');
  blurTarget.classList.add('asm-blur-danger');

  const evidenceHtml = buildEvidenceHtml(threats);

  const overlay = document.createElement('div');
  overlay.className = 'asm-result-banner asm-result-danger';
  overlay.setAttribute('data-asm-banner', blockId);
  overlay.innerHTML = `
    <div class="asm-banner-inner">
      <span class="asm-banner-icon">⛔</span>
      <div class="asm-banner-detail">
        <strong>위험한 코드가 감지되었습니다</strong> — ${escapeHtml(category)}
        <p class="asm-banner-reason">${escapeHtml(reason)}</p>
        ${evidenceHtml}
      </div>
    </div>
    <div class="asm-danger-actions">
      <button class="asm-btn asm-btn-block">차단 유지</button>
      <button class="asm-btn asm-btn-reveal">무시하고 표시</button>
    </div>
  `;

  blurTarget.parentElement.insertBefore(overlay, blurTarget);
  blockStates.set(blockId, { state: 'danger', blurTarget, overlay });

  // 차단 유지 버튼 → 코드 블록 완전 숨김
  overlay.querySelector('.asm-btn-block').addEventListener('click', () => {
    blurTarget.style.display = 'none';
    overlay.querySelector('.asm-danger-actions').innerHTML =
      '<span class="asm-blocked-label">🚫 차단됨</span>';
    blockStates.set(blockId, { ...blockStates.get(blockId), state: 'blocked' });
  });

  // 무시하고 표시 버튼 → 블러 해제
  overlay.querySelector('.asm-btn-reveal').addEventListener('click', () => {
    removeBlur(blurTarget);
    overlay.querySelector('.asm-danger-actions').innerHTML =
      '<span class="asm-revealed-label">⚠️ 사용자가 표시를 허용했습니다</span>';
    blockStates.set(blockId, { ...blockStates.get(blockId), state: 'revealed' });
  });

  // 증거 토글 버튼
  setupEvidenceToggle(overlay);
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
  element.classList.remove('asm-blur-pending', 'asm-blur-danger');
}

/**
 * "분석 중..." 스캐닝 배너 생성
 */
function createScanningBanner(blockId) {
  const banner = document.createElement('div');
  banner.className = 'asm-result-banner asm-scanning';
  banner.setAttribute('data-asm-banner', blockId);
  banner.innerHTML = `
    <div class="asm-banner-inner">
      <span class="asm-spinner"></span>
      <span class="asm-banner-text">보안 분석 중...</span>
    </div>
  `;
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
