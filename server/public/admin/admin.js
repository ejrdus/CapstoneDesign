/**
 * AI Script Monitor — 관리자 페이지 SPA
 */

const API_BASE = window.location.origin + '/api/admin';
const app = document.getElementById('app');

// ─── 상태 관리 ──────────────────────────────────────────────

let state = {
  token: localStorage.getItem('asm_admin_token'),
  admin: JSON.parse(localStorage.getItem('asm_admin_info') || 'null'),
  currentPage: 'dashboard',
  logs: { data: [], pagination: {} },
  stats: null,
  requests: [],
  admins: [],
  filters: { riskLevel: '', aiService: '', language: '', search: '', page: 1 },
  modal: null,
};

// ─── API 호출 ───────────────────────────────────────────────

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json();

  if (res.status === 401) {
    logout();
    throw new Error('인증 만료');
  }

  if (!res.ok) throw new Error(data.error || '요청 실패');
  return data;
}

// ─── 인증 ───────────────────────────────────────────────────

function login(token, admin) {
  state.token = token;
  state.admin = admin;
  localStorage.setItem('asm_admin_token', token);
  localStorage.setItem('asm_admin_info', JSON.stringify(admin));
  render();
}

function logout() {
  state.token = null;
  state.admin = null;
  localStorage.removeItem('asm_admin_token');
  localStorage.removeItem('asm_admin_info');
  render();
}

// ─── 렌더링 ─────────────────────────────────────────────────

function render() {
  if (!state.token) {
    renderLogin();
  } else {
    renderDashboard();
  }
}

function renderLogin() {
  let mode = 'login';
  let error = '';
  let success = '';

  function draw() {
    app.innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <div class="login-logo">
            <span class="shield">🛡️</span>
            <h1>AI Script Monitor</h1>
            <p>관리자 콘솔</p>
          </div>
          <div class="login-tabs">
            <button class="${mode === 'login' ? 'active' : ''}" data-mode="login">로그인</button>
            <button class="${mode === 'register' ? 'active' : ''}" data-mode="register">가입 요청</button>
          </div>
          ${error ? `<div class="login-error">${error}</div>` : ''}
          ${success ? `<div class="login-success">${success}</div>` : ''}
          ${mode === 'login' ? `
            <form id="loginForm">
              <div class="form-group">
                <label>아이디</label>
                <input type="text" name="username" placeholder="관리자 아이디" required autocomplete="username">
              </div>
              <div class="form-group">
                <label>비밀번호</label>
                <input type="password" name="password" placeholder="비밀번호" required autocomplete="current-password">
              </div>
              <button type="submit" class="btn btn-primary">로그인</button>
            </form>
          ` : `
            <form id="registerForm">
              <div class="form-group">
                <label>아이디</label>
                <input type="text" name="username" placeholder="3자 이상" required minlength="3">
              </div>
              <div class="form-group">
                <label>비밀번호</label>
                <input type="password" name="password" placeholder="6자 이상" required minlength="6">
              </div>
              <div class="form-group">
                <label>가입 사유</label>
                <textarea name="reason" placeholder="관리자 접근이 필요한 사유를 입력하세요"></textarea>
              </div>
              <button type="submit" class="btn btn-primary">가입 요청</button>
            </form>
          `}
        </div>
      </div>
    `;

    // 탭 전환
    app.querySelectorAll('.login-tabs button').forEach(btn => {
      btn.addEventListener('click', () => { mode = btn.dataset.mode; error = ''; success = ''; draw(); });
    });

    // 로그인 처리
    const loginForm = app.querySelector('#loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        error = ''; success = '';
        const fd = new FormData(e.target);
        try {
          const data = await api('/login', {
            method: 'POST',
            body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
          });
          login(data.token, data.admin);
        } catch (err) { error = err.message; draw(); }
      });
    }

    // 가입 요청 처리
    const registerForm = app.querySelector('#registerForm');
    if (registerForm) {
      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        error = ''; success = '';
        const fd = new FormData(e.target);
        try {
          const data = await api('/register', {
            method: 'POST',
            body: JSON.stringify({
              username: fd.get('username'),
              password: fd.get('password'),
              reason: fd.get('reason'),
            }),
          });
          success = data.message;
          mode = 'login';
          draw();
        } catch (err) { error = err.message; draw(); }
      });
    }
  }

  draw();
}

// ─── 대시보드 렌더링 ────────────────────────────────────────

function renderDashboard() {
  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-logo">
          <span class="shield">🛡️</span>
          <div>
            <h2>ASM Admin</h2>
            <span>AI Script Monitor</span>
          </div>
        </div>
        <nav class="nav-menu">
          <button class="nav-item ${state.currentPage === 'dashboard' ? 'active' : ''}" data-page="dashboard">
            <span class="nav-icon">📊</span> 대시보드
          </button>
          <button class="nav-item ${state.currentPage === 'logs' ? 'active' : ''}" data-page="logs">
            <span class="nav-icon">📋</span> 분석 로그
          </button>
          ${state.admin?.role === 'superadmin' ? `
            <button class="nav-item ${state.currentPage === 'requests' ? 'active' : ''}" data-page="requests">
              <span class="nav-icon">📬</span> 가입 요청
              <span class="nav-badge" id="requestBadge" style="display:none">0</span>
            </button>
            <button class="nav-item ${state.currentPage === 'admins' ? 'active' : ''}" data-page="admins">
              <span class="nav-icon">👥</span> 관리자 관리
            </button>
          ` : ''}
        </nav>
        <div class="sidebar-footer">
          <div class="admin-info">
            <div class="admin-avatar">${(state.admin?.username || 'A')[0].toUpperCase()}</div>
            <div>
              <div class="admin-name">${state.admin?.username || ''}</div>
              <div class="admin-role">${state.admin?.role === 'superadmin' ? '최고 관리자' : '관리자'}</div>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm logout-btn" id="logoutBtn">로그아웃</button>
        </div>
      </aside>
      <main class="main-content" id="mainContent">
        <div class="loading"><div class="spinner"></div><p>로딩 중...</p></div>
      </main>
    </div>
  `;

  // 네비게이션 이벤트
  app.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentPage = btn.dataset.page;
      state.filters = { riskLevel: '', aiService: '', language: '', search: '', page: 1 };
      renderDashboard();
    });
  });

  app.querySelector('#logoutBtn').addEventListener('click', logout);

  // 페이지 컨텐츠 로드
  loadPageContent();
}

async function loadPageContent() {
  const main = document.getElementById('mainContent');
  try {
    switch (state.currentPage) {
      case 'dashboard': await renderStatsPage(main); break;
      case 'logs': await renderLogsPage(main); break;
      case 'requests': await renderRequestsPage(main); break;
      case 'admins': await renderAdminsPage(main); break;
    }
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>오류 발생</h3><p>${err.message}</p></div>`;
  }

  // 가입 요청 뱃지 업데이트
  if (state.admin?.role === 'superadmin') {
    try {
      const reqs = await api('/requests');
      const pending = reqs.filter(r => r.status === 'pending').length;
      const badge = document.getElementById('requestBadge');
      if (badge) {
        badge.textContent = pending;
        badge.style.display = pending > 0 ? 'inline' : 'none';
      }
    } catch (e) {}
  }
}

// ─── 대시보드 통계 페이지 ───────────────────────────────────

async function renderStatsPage(container) {
  const stats = await api('/stats');
  state.stats = stats;

  const { overview, byService, byLanguage, daily, topCategories } = stats;
  const maxService = Math.max(...byService.map(s => s.count), 1);
  const maxLang = Math.max(...byLanguage.map(l => l.count), 1);

  container.innerHTML = `
    <div class="page-header">
      <h1>대시보드</h1>
      <p>AI Script Monitor 전체 분석 현황을 한눈에 확인합니다.</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-icon">📊</span>
        <div class="stat-label">전체 분석</div>
        <div class="stat-value">${overview.total.toLocaleString()}</div>
      </div>
      <div class="stat-card danger">
        <span class="stat-icon">🔴</span>
        <div class="stat-label">위험</div>
        <div class="stat-value">${overview.danger.toLocaleString()}</div>
      </div>
      <div class="stat-card caution">
        <span class="stat-icon">🟡</span>
        <div class="stat-label">주의</div>
        <div class="stat-value">${overview.caution.toLocaleString()}</div>
      </div>
      <div class="stat-card safe">
        <span class="stat-icon">🟢</span>
        <div class="stat-label">안전</div>
        <div class="stat-value">${overview.safe.toLocaleString()}</div>
      </div>
    </div>

    <div class="charts-grid">
      <div class="chart-card">
        <h3>AI 서비스별 분석</h3>
        <div class="bar-chart">
          ${byService.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;">데이터 없음</p>' :
            byService.map(s => `
              <div class="bar-item">
                <span class="bar-label">${s.ai_service || 'Unknown'}</span>
                <div class="bar-track">
                  <div class="bar-fill accent" style="width:${(s.count / maxService * 100)}%"></div>
                </div>
                <span class="bar-value">${s.count}</span>
              </div>
            `).join('')
          }
        </div>
      </div>
      <div class="chart-card">
        <h3>언어별 분석</h3>
        <div class="bar-chart">
          ${byLanguage.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;">데이터 없음</p>' :
            byLanguage.map(l => `
              <div class="bar-item">
                <span class="bar-label">${l.language || 'unknown'}</span>
                <div class="bar-track">
                  <div class="bar-fill accent" style="width:${(l.count / maxLang * 100)}%"></div>
                </div>
                <span class="bar-value">${l.count}</span>
              </div>
            `).join('')
          }
        </div>
      </div>
      <div class="chart-card">
        <h3>주요 위협 카테고리</h3>
        <div class="bar-chart">
          ${topCategories.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;">감지된 위협 없음</p>' :
            topCategories.map(c => {
              const maxCat = Math.max(...topCategories.map(x => x.count), 1);
              return `
                <div class="bar-item">
                  <span class="bar-label" style="width:120px">${c.category}</span>
                  <div class="bar-track">
                    <div class="bar-fill danger" style="width:${(c.count / maxCat * 100)}%"></div>
                  </div>
                  <span class="bar-value">${c.count}</span>
                </div>
              `;
            }).join('')
          }
        </div>
      </div>
      <div class="chart-card">
        <h3>최근 7일 분석 추이</h3>
        <div class="bar-chart">
          ${daily.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;">데이터 없음</p>' :
            (() => {
              const maxDaily = Math.max(...daily.map(d => d.count), 1);
              return daily.map(d => `
                <div class="bar-item">
                  <span class="bar-label">${d.date.slice(5)}</span>
                  <div class="bar-track">
                    <div class="bar-fill safe" style="width:${(d.count / maxDaily * 100)}%"></div>
                    ${d.danger_count > 0 ? `<div class="bar-fill danger" style="width:${(d.danger_count / maxDaily * 100)}%;position:absolute;top:0;left:0;opacity:0.7"></div>` : ''}
                  </div>
                  <span class="bar-value">${d.count}</span>
                </div>
              `).join('');
            })()
          }
        </div>
      </div>
    </div>
  `;
}

// ─── 분석 로그 페이지 ───────────────────────────────────────

async function renderLogsPage(container) {
  const { riskLevel, aiService, language, search, page } = state.filters;
  const params = new URLSearchParams();
  params.set('page', page);
  params.set('limit', 20);
  if (riskLevel) params.set('riskLevel', riskLevel);
  if (aiService) params.set('aiService', aiService);
  if (language) params.set('language', language);
  if (search) params.set('search', search);

  const data = await api(`/logs?${params}`);
  state.logs = data;

  const riskBadge = (level) => {
    const map = { danger: ['위험', 'badge-danger'], caution: ['주의', 'badge-caution'], safe: ['안전', 'badge-safe'] };
    const [label, cls] = map[level] || ['알 수 없음', ''];
    return `<span class="badge ${cls}">${label}</span>`;
  };

  container.innerHTML = `
    <div class="page-header">
      <h1>분석 로그</h1>
      <p>모든 코드 분석 결과를 확인하고 검색합니다.</p>
    </div>

    <div class="table-card">
      <div class="table-header">
        <h3>전체 ${data.pagination.total.toLocaleString()}건</h3>
        <div class="table-filters">
          <select class="filter-select" id="filterRisk">
            <option value="">전체 등급</option>
            <option value="danger" ${riskLevel === 'danger' ? 'selected' : ''}>위험</option>
            <option value="caution" ${riskLevel === 'caution' ? 'selected' : ''}>주의</option>
            <option value="safe" ${riskLevel === 'safe' ? 'selected' : ''}>안전</option>
          </select>
          <select class="filter-select" id="filterService">
            <option value="">전체 서비스</option>
            <option value="ChatGPT" ${aiService === 'ChatGPT' ? 'selected' : ''}>ChatGPT</option>
            <option value="Claude" ${aiService === 'Claude' ? 'selected' : ''}>Claude</option>
            <option value="Gemini" ${aiService === 'Gemini' ? 'selected' : ''}>Gemini</option>
          </select>
          <input class="filter-input" type="text" placeholder="검색..." value="${search}" id="filterSearch" style="width:180px">
        </div>
      </div>

      ${data.logs.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <h3>분석 로그가 없습니다</h3>
          <p>코드 분석이 수행되면 여기에 표시됩니다.</p>
        </div>
      ` : `
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>등급</th>
              <th>서비스</th>
              <th>언어</th>
              <th>카테고리</th>
              <th>사유</th>
              <th>분석 시각</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${data.logs.map(log => `
              <tr>
                <td>#${log.id}</td>
                <td>${riskBadge(log.risk_level)}</td>
                <td><span class="badge badge-service">${log.ai_service || '-'}</span></td>
                <td><span class="badge badge-lang">${log.language || '-'}</span></td>
                <td>${log.category || '-'}</td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${log.reason || '-'}</td>
                <td>${formatDate(log.analyzed_at)}</td>
                <td><button class="btn btn-ghost btn-sm" data-view="${log.id}">상세</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="pagination">
          <button id="prevPage" ${data.pagination.page <= 1 ? 'disabled' : ''}>&larr; 이전</button>
          <span class="page-info">${data.pagination.page} / ${data.pagination.totalPages}</span>
          <button id="nextPage" ${data.pagination.page >= data.pagination.totalPages ? 'disabled' : ''}>다음 &rarr;</button>
        </div>
      `}
    </div>
  `;

  // 필터 이벤트
  const applyFilter = () => {
    state.filters.riskLevel = document.getElementById('filterRisk').value;
    state.filters.aiService = document.getElementById('filterService').value;
    state.filters.search = document.getElementById('filterSearch').value;
    state.filters.page = 1;
    renderLogsPage(container);
  };

  document.getElementById('filterRisk').addEventListener('change', applyFilter);
  document.getElementById('filterService').addEventListener('change', applyFilter);
  let searchTimer;
  document.getElementById('filterSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilter, 400);
  });

  // 페이지네이션
  const prevBtn = document.getElementById('prevPage');
  const nextBtn = document.getElementById('nextPage');
  if (prevBtn) prevBtn.addEventListener('click', () => { state.filters.page--; renderLogsPage(container); });
  if (nextBtn) nextBtn.addEventListener('click', () => { state.filters.page++; renderLogsPage(container); });

  // 상세 보기
  container.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => showLogDetail(btn.dataset.view));
  });
}

async function showLogDetail(id) {
  const log = await api(`/logs/${id}`);
  let details = {};
  try { details = typeof log.details === 'string' ? JSON.parse(log.details) : (log.details || {}); } catch(e) {}

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>분석 상세 #${log.id}</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="detail-row">
          <span class="detail-label">위험 등급</span>
          <span class="detail-value">${riskBadgeHtml(log.risk_level)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">AI 서비스</span>
          <span class="detail-value"><span class="badge badge-service">${log.ai_service || '-'}</span></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">언어</span>
          <span class="detail-value"><span class="badge badge-lang">${log.language || '-'}</span></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">카테고리</span>
          <span class="detail-value">${log.category || '-'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">분석 사유</span>
          <span class="detail-value">${log.reason || '-'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">분석 시각</span>
          <span class="detail-value">${log.analyzed_at}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">IP 주소</span>
          <span class="detail-value">${log.ip_address || '-'}</span>
        </div>
        ${details.threats && details.threats.length > 0 ? `
          <div class="detail-row">
            <span class="detail-label">위협 상세</span>
            <div class="detail-value">
              ${details.threats.map(t => `
                <div style="margin-bottom:8px;padding:8px;background:var(--bg);border-radius:6px;border:1px solid var(--border)">
                  <strong style="color:var(--danger)">${t.category || t.type}</strong>
                  ${t.severity ? ` <span style="font-size:11px;color:var(--text-muted)">(심각도: ${t.severity})</span>` : ''}
                  <p style="margin:4px 0;font-size:12px;color:var(--text-secondary)">${t.description || ''}</p>
                  ${t.evidence ? `<code style="display:block;background:rgba(0,0,0,0.3);padding:6px 8px;border-radius:4px;font-size:11px;margin-top:4px;color:var(--caution)">${escapeHtml(t.evidence)}</code>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
        <div style="margin-top:16px">
          <span class="detail-label" style="display:block;margin-bottom:8px">분석된 코드</span>
          <div class="code-block">${escapeHtml(log.code)}</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ─── 가입 요청 페이지 ───────────────────────────────────────

async function renderRequestsPage(container) {
  const requests = await api('/requests');
  state.requests = requests;
  const pending = requests.filter(r => r.status === 'pending');
  const processed = requests.filter(r => r.status !== 'pending');

  container.innerHTML = `
    <div class="page-header">
      <h1>가입 요청</h1>
      <p>관리자 가입 요청을 승인하거나 거절합니다.</p>
    </div>

    <div class="table-card" style="margin-bottom:24px">
      <div class="table-header">
        <h3>대기 중 (${pending.length}건)</h3>
      </div>
      ${pending.length === 0 ? `
        <div class="empty-state" style="padding:40px">
          <div class="empty-icon">✅</div>
          <h3>대기 중인 요청이 없습니다</h3>
        </div>
      ` : `
        <div class="admin-list" style="padding:16px">
          ${pending.map(r => `
            <div class="admin-card">
              <div class="admin-avatar">${r.username[0].toUpperCase()}</div>
              <div class="admin-card-info">
                <h4>${escapeHtml(r.username)}</h4>
                <p>사유: ${escapeHtml(r.request_reason || '미입력')} | 요청일: ${formatDate(r.requested_at)}</p>
              </div>
              <div class="admin-card-actions">
                <button class="btn btn-approve btn-sm" data-approve="${r.id}">승인</button>
                <button class="btn btn-reject btn-sm" data-reject="${r.id}">거절</button>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>

    ${processed.length > 0 ? `
      <div class="table-card">
        <div class="table-header"><h3>처리 완료</h3></div>
        <table>
          <thead><tr><th>아이디</th><th>상태</th><th>요청일</th><th>처리일</th><th>처리자</th></tr></thead>
          <tbody>
            ${processed.map(r => `
              <tr>
                <td>${escapeHtml(r.username)}</td>
                <td><span class="badge badge-${r.status}">${r.status === 'approved' ? '승인됨' : '거절됨'}</span></td>
                <td>${formatDate(r.requested_at)}</td>
                <td>${formatDate(r.reviewed_at)}</td>
                <td>${r.reviewed_by || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : ''}
  `;

  container.querySelectorAll('[data-approve]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/requests/${btn.dataset.approve}/approve`, { method: 'POST' });
        renderRequestsPage(container);
      } catch (err) { alert(err.message); }
    });
  });

  container.querySelectorAll('[data-reject]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('정말 거절하시겠습니까?')) return;
      try {
        await api(`/requests/${btn.dataset.reject}/reject`, { method: 'POST' });
        renderRequestsPage(container);
      } catch (err) { alert(err.message); }
    });
  });
}

// ─── 관리자 관리 페이지 ─────────────────────────────────────

async function renderAdminsPage(container) {
  const admins = await api('/admins');
  state.admins = admins;

  container.innerHTML = `
    <div class="page-header">
      <h1>관리자 관리</h1>
      <p>등록된 관리자 계정을 관리합니다.</p>
    </div>

    <div class="admin-list">
      ${admins.map(a => `
        <div class="admin-card">
          <div class="admin-avatar" style="${a.role === 'superadmin' ? 'background:var(--caution)' : ''}">${a.username[0].toUpperCase()}</div>
          <div class="admin-card-info">
            <h4>${escapeHtml(a.username)} ${a.role === 'superadmin' ? '<span class="badge badge-caution" style="margin-left:6px">최고 관리자</span>' : '<span class="badge badge-safe" style="margin-left:6px">관리자</span>'}</h4>
            <p>가입일: ${formatDate(a.created_at)} | 최근 접속: ${a.last_login ? formatDate(a.last_login) : '없음'}</p>
          </div>
          ${a.id !== state.admin?.id && a.role !== 'superadmin' ? `
            <div class="admin-card-actions">
              <button class="btn btn-danger btn-sm" data-delete="${a.id}">삭제</button>
            </div>
          ` : ''}
        </div>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('정말 삭제하시겠습니까?')) return;
      try {
        await api(`/admins/${btn.dataset.delete}`, { method: 'DELETE' });
        renderAdminsPage(container);
      } catch (err) { alert(err.message); }
    });
  });
}

// ─── 유틸리티 ───────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function riskBadgeHtml(level) {
  const map = { danger: ['위험', 'badge-danger'], caution: ['주의', 'badge-caution'], safe: ['안전', 'badge-safe'] };
  const [label, cls] = map[level] || ['알 수 없음', ''];
  return `<span class="badge ${cls}">${label}</span>`;
}

// ─── 초기 렌더링 ────────────────────────────────────────────

render();
