/**
 * Pactum Frontend — app.js
 * iOS-style white UI logic & mock data
 */

'use strict';

// ── Contract Info ─────────────────────────────────────────────
const CONTRACT_ID = 'CBADTVTJ6IN332HIKZ7LWUYMYTLPZYCEBV3X2HS47VHR5UDBHQ3GAA7E';
const NETWORK = 'testnet';
const EXPLORER_BASE = `https://stellar.expert/explorer/${NETWORK}`;

// ── Mock commitment data (demo) ─────────────────────────────────
const mockCommitments = [
  {
    id: 1,
    issuer: 'GAJKUMA6V4MJKQPFM4MXNMWQZX3CTMK2KMMCSZQPK5JXBZWBZM7S4C',
    counterparty: 'GB4UFBX57KE2RPEXB4NCPQHXL5UZL7HSFBVQ2YEZQDZ2DXR2X3CHHZX',
    terms_hash: 'a3f9c1d2e4b5678901234567890abcdef1234567890abcdef1234567890ab',
    due_at: Math.floor(Date.now() / 1000) - 86400 * 5,
    status: 'Fulfilled',
    created_at: Math.floor(Date.now() / 1000) - 86400 * 20,
    attested_at: Math.floor(Date.now() / 1000) - 86400 * 4,
  },
  {
    id: 2,
    issuer: 'GAJKUMA6V4MJKQPFM4MXNMWQZX3CTMK2KMMCSZQPK5JXBZWBZM7S4C',
    counterparty: 'GCJUKUMADK5PKZF7MCQBBNLRH2AIZQPK5JXBZWBZM7S4CGAJKUMA6V4',
    terms_hash: 'b7e2d1c3f5a6789012345678901abcdef234567890abcdef234567890abc',
    due_at: Math.floor(Date.now() / 1000) - 86400 * 10,
    status: 'Breached',
    created_at: Math.floor(Date.now() / 1000) - 86400 * 30,
    attested_at: Math.floor(Date.now() / 1000) - 86400 * 8,
  },
  {
    id: 3,
    issuer: 'GB4UFBX57KE2RPEXB4NCPQHXL5UZL7HSFBVQ2YEZQDZ2DXR2X3CHHZX',
    counterparty: 'GAJKUMA6V4MJKQPFM4MXNMWQZX3CTMK2KMMCSZQPK5JXBZWBZM7S4C',
    terms_hash: 'c8f3e2d4a6b7890123456789012abcdef345678901abcdef345678901abcd',
    due_at: Math.floor(Date.now() / 1000) - 86400 * 2,
    status: 'Fulfilled',
    created_at: Math.floor(Date.now() / 1000) - 86400 * 15,
    attested_at: Math.floor(Date.now() / 1000) - 86400 * 1,
  },
  {
    id: 4,
    issuer: 'GCJUKUMADK5PKZF7MCQBBNLRH2AIZQPK5JXBZWBZM7S4CGAJKUMA6V4',
    counterparty: 'GB4UFBX57KE2RPEXB4NCPQHXL5UZL7HSFBVQ2YEZQDZ2DXR2X3CHHZX',
    terms_hash: 'd9a4f3e5b7c8901234567890123abcdef456789012abcdef456789012abcde',
    due_at: Math.floor(Date.now() / 1000) + 86400 * 8,
    status: 'Pending',
    created_at: Math.floor(Date.now() / 1000) - 86400 * 2,
    attested_at: null,
  },
];

// ── Navigation ────────────────────────────────────────────────
const PAGE_TITLES = {
  dashboard:    'Dashboard',
  commitments:  'Commitments',
  create:       'Create Commitment',
  attest:       'Attest Commitment',
  dispute:      'Raise Dispute',
  resolve:      'Resolve Dispute',
  reputation:   'Reputation Lookup',
  lookup:       'Get Commitment',
  initialize:   'Initialize Contract',
};

function navigate(pageId) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Show target
  const page = document.getElementById(`page-${pageId}`);
  const navBtn = document.getElementById(`nav-${pageId}`);
  if (page) page.classList.add('active');
  if (navBtn) navBtn.classList.add('active');

  document.getElementById('topbar-title').textContent = PAGE_TITLES[pageId] || pageId;

  // Lazy-render
  if (pageId === 'dashboard') renderDashboard();
  if (pageId === 'commitments') renderCommitmentsList(mockCommitments);
  if (pageId === 'lookup') renderSampleCommitments();
  if (pageId === 'create') setupCreatePreview();
}

// ── Dashboard ─────────────────────────────────────────────────
function renderDashboard() {
  const total     = mockCommitments.length;
  const fulfilled = mockCommitments.filter(c => c.status === 'Fulfilled').length;
  const pending   = mockCommitments.filter(c => c.status === 'Pending').length;
  const breached  = mockCommitments.filter(c => c.status === 'Breached').length;

  document.getElementById('stat-total').textContent     = total;
  document.getElementById('stat-fulfilled').textContent = fulfilled;
  document.getElementById('stat-pending').textContent   = pending;
  document.getElementById('stat-breached').textContent  = breached;

  document.getElementById('badge-commitments').textContent = total;

  // Render recent 3 commitments
  const list = document.getElementById('dashboard-list');
  const recent = [...mockCommitments].reverse().slice(0, 3);
  list.innerHTML = recent.map(c => commitmentItemHTML(c)).join('');
}

function refreshDashboard() {
  showToast('Refreshed from on-chain data', 'success');
  renderDashboard();
}

// ── Commitment List ───────────────────────────────────────────
function renderCommitmentsList(data) {
  const el = document.getElementById('commitments-list-page');
  if (!data.length) {
    el.innerHTML = emptyStateHTML('No commitments found', 'No commitments match the selected filter.');
    return;
  }
  el.innerHTML = data.map(c => commitmentItemHTML(c)).join('');
}

function filterCommitments(status, btn) {
  document.querySelectorAll('#filter-tabs .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filtered = status === 'all'
    ? mockCommitments
    : mockCommitments.filter(c => c.status.toLowerCase() === status);
  renderCommitmentsList(filtered);
}

const AVATAR_TINTS = [
  { bg: '#e8e4f3', color: '#5b4d8a' },  // lavender
  { bg: '#dff0d8', color: '#3a7d44' },  // green
  { bg: '#dde8f5', color: '#3060a0' },  // blue
  { bg: '#fae8dc', color: '#a0522d' },  // peach
];

function commitmentItemHTML(c) {
  const shortIssuer = shortAddr(c.issuer);
  const shortCp = shortAddr(c.counterparty);
  const dueDateStr = fmtDate(c.due_at);
  const avatarLetter = c.issuer.charAt(1).toUpperCase();
  const statusCls = c.status.toLowerCase();
  const tint = AVATAR_TINTS[(c.id - 1) % AVATAR_TINTS.length];

  return `
    <div class="commitment-item" onclick="openCommitmentDetail(${c.id})" id="cmt-item-${c.id}">
      <div class="commitment-avatar" style="background:${tint.bg};color:${tint.color};">${avatarLetter}</div>
      <div class="commitment-info">
        <div class="commitment-id">Commitment #${c.id}</div>
        <div class="commitment-parties">${shortIssuer} &rarr; ${shortCp}</div>
        <div class="commitment-due">Due ${dueDateStr}</div>
      </div>
      <div class="commitment-actions">
        <span class="badge ${statusCls}">
          <span class="badge-dot"></span>
          ${c.status}
        </span>
      </div>
      <svg class="chevron-right" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 4l4 4-4 4"/>
      </svg>
    </div>
  `;
}

function emptyStateHTML(title, desc) {
  return `
    <div class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="20" height="20" rx="4"/>
          <path d="M9 9h8M9 13h8M9 17h5"/>
        </svg>
      </div>
      <div class="empty-title">${title}</div>
      <div class="empty-desc">${desc}</div>
    </div>
  `;
}

// ── Sample Commitments (Lookup page) ─────────────────────────
function renderSampleCommitments() {
  const el = document.getElementById('sample-commitments');
  el.innerHTML = mockCommitments.map(c => commitmentItemHTML(c)).join('');
}

// ── Commitment Detail Modal ───────────────────────────────────
function openCommitmentDetail(id) {
  const c = mockCommitments.find(m => m.id === id);
  if (!c) return;

  document.getElementById('modal-commitment-title').textContent = `Commitment #${c.id}`;

  const statusCls = c.status.toLowerCase();
  document.getElementById('modal-commitment-body').innerHTML = `
    <div class="detail-panel" style="margin-bottom:16px;">
      <div class="detail-row">
        <span class="detail-key">Status</span>
        <span class="detail-val">
          <span class="badge ${statusCls}"><span class="badge-dot"></span>${c.status}</span>
        </span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Issuer</span>
        <span class="detail-val mono">${c.issuer}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Counterparty</span>
        <span class="detail-val mono">${c.counterparty}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Terms Hash</span>
        <span class="detail-val mono">${c.terms_hash}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Due At</span>
        <span class="detail-val">${fmtDateFull(c.due_at)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Created At</span>
        <span class="detail-val">${fmtDateFull(c.created_at)}</span>
      </div>
      ${c.attested_at ? `
      <div class="detail-row">
        <span class="detail-key">Attested At</span>
        <span class="detail-val">${fmtDateFull(c.attested_at)}</span>
      </div>` : ''}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button class="btn btn-secondary btn-sm" onclick="prefillAttestWith(${c.id}); closeModal('modal-commitment-detail'); navigate('attest');">Attest</button>
      ${c.status === 'Fulfilled' || c.status === 'Late' || c.status === 'Breached' ?
        `<button class="btn btn-secondary btn-sm" onclick="prefillDisputeWith(${c.id}); closeModal('modal-commitment-detail'); navigate('dispute');">Dispute</button>` : ''}
      <a href="${EXPLORER_BASE}/contract/${CONTRACT_ID}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">View on Explorer</a>
    </div>
  `;

  openModal('modal-commitment-detail');
}

// ── Create Commitment ─────────────────────────────────────────
function setupCreatePreview() {
  const fields = ['create-issuer', 'create-counterparty', 'create-terms', 'create-dueat'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateCreatePreview);
  });
}

function updateCreatePreview() {
  const issuer = document.getElementById('create-issuer').value || '—';
  const cp     = document.getElementById('create-counterparty').value || '—';
  const terms  = document.getElementById('create-terms').value;
  const dueat  = document.getElementById('create-dueat').value;

  document.getElementById('preview-issuer').textContent      = issuer.length > 30 ? shortAddr(issuer) : issuer;
  document.getElementById('preview-counterparty').textContent = cp.length > 30 ? shortAddr(cp) : cp;
  document.getElementById('preview-hash').textContent        = terms ? simpleHash(terms) : '—';
  document.getElementById('preview-dueat').textContent       = dueat ? new Date(dueat).toLocaleString() : '—';
}

function submitCreateCommitment() {
  const issuer = document.getElementById('create-issuer').value.trim();
  const cp     = document.getElementById('create-counterparty').value.trim();
  const terms  = document.getElementById('create-terms').value.trim();
  const dueat  = document.getElementById('create-dueat').value;

  if (!issuer || !cp || !terms || !dueat) {
    showToast('Please fill in all fields', 'error'); return;
  }
  if (!issuer.startsWith('G') || issuer.length < 20) {
    showToast('Issuer address looks invalid', 'error'); return;
  }
  if (!cp.startsWith('G') || cp.length < 20) {
    showToast('Counterparty address looks invalid', 'error'); return;
  }
  if (new Date(dueat) <= new Date()) {
    showToast('Due date must be in the future', 'error'); return;
  }

  simulateLoading('btn-create', () => {
    const newId = mockCommitments.length + 1;
    const newCommitment = {
      id: newId,
      issuer, counterparty: cp,
      terms_hash: simpleHash(terms),
      due_at: Math.floor(new Date(dueat).getTime() / 1000),
      status: 'Pending',
      created_at: Math.floor(Date.now() / 1000),
      attested_at: null,
    };
    mockCommitments.push(newCommitment);
    document.getElementById('badge-commitments').textContent = mockCommitments.length;
    showToast(`Commitment #${newId} created successfully`, 'success');
    clearCreateForm();
    navigate('commitments');
  });
}

function clearCreateForm() {
  ['create-issuer', 'create-counterparty', 'create-terms', 'create-dueat'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('preview-issuer').textContent = '—';
  document.getElementById('preview-counterparty').textContent = '—';
  document.getElementById('preview-hash').textContent = '—';
  document.getElementById('preview-dueat').textContent = '—';
}

// ── Attest ────────────────────────────────────────────────────
function submitAttest() {
  const caller  = document.getElementById('attest-caller').value.trim();
  const id      = parseInt(document.getElementById('attest-id').value);
  const outcome = document.getElementById('attest-outcome').value;

  if (!caller || !id || !outcome) {
    showToast('Please fill in all fields', 'error'); return;
  }
  const commitment = mockCommitments.find(c => c.id === id);
  if (!commitment) {
    showToast(`Commitment #${id} not found`, 'error'); return;
  }
  if (commitment.status !== 'Pending') {
    showToast(`Commitment #${id} is already ${commitment.status}`, 'error'); return;
  }
  if (caller !== commitment.issuer && caller !== commitment.counterparty) {
    showToast('Caller must be issuer or counterparty', 'error'); return;
  }

  simulateLoading('btn-attest', () => {
    commitment.status = outcome;
    commitment.attested_at = Math.floor(Date.now() / 1000);
    showToast(`Commitment #${id} attested as ${outcome}`, 'success');
    document.getElementById('attest-caller').value = '';
    document.getElementById('attest-id').value = '';
    document.getElementById('attest-outcome').value = '';
  });
}

function prefillAttest() {
  const id = document.getElementById('lookup-id').value;
  if (id) {
    navigate('attest');
    document.getElementById('attest-id').value = id;
  }
}
function prefillAttestWith(id) {
  document.getElementById('attest-id').value = id;
}

// ── Dispute ───────────────────────────────────────────────────
function submitDispute() {
  const caller = document.getElementById('dispute-caller').value.trim();
  const id     = parseInt(document.getElementById('dispute-id').value);

  if (!caller || !id) {
    showToast('Please fill in all fields', 'error'); return;
  }
  const commitment = mockCommitments.find(c => c.id === id);
  if (!commitment) {
    showToast(`Commitment #${id} not found`, 'error'); return;
  }
  if (commitment.status === 'Pending') {
    showToast('Cannot dispute a pending commitment — attest first', 'error'); return;
  }
  if (commitment.status === 'Disputed') {
    showToast(`Commitment #${id} is already disputed`, 'error'); return;
  }
  if (caller !== commitment.issuer && caller !== commitment.counterparty) {
    showToast('Caller must be issuer or counterparty', 'error'); return;
  }

  simulateLoading('btn-dispute', () => {
    commitment.status = 'Disputed';
    showToast(`Dispute raised on Commitment #${id}`, 'warning');
    document.getElementById('dispute-caller').value = '';
    document.getElementById('dispute-id').value = '';
  });
}

function prefillDispute() {
  const id = document.getElementById('lookup-id').value;
  if (id) {
    navigate('dispute');
    document.getElementById('dispute-id').value = id;
  }
}
function prefillDisputeWith(id) {
  document.getElementById('dispute-id').value = id;
}

// ── Resolve Dispute ───────────────────────────────────────────
const MOCK_ARBITRATOR = 'GARBITRATORSXYZ123456789ABCDEF012345STELLAR1PACTUM';

function submitResolve() {
  const arbitrator = document.getElementById('resolve-arbitrator').value.trim();
  const id         = parseInt(document.getElementById('resolve-id').value);
  const outcome    = document.getElementById('resolve-outcome').value;

  if (!arbitrator || !id || !outcome) {
    showToast('Please fill in all fields', 'error'); return;
  }
  const commitment = mockCommitments.find(c => c.id === id);
  if (!commitment) {
    showToast(`Commitment #${id} not found`, 'error'); return;
  }
  if (commitment.status !== 'Disputed') {
    showToast(`Commitment #${id} is not in Disputed state`, 'error'); return;
  }

  simulateLoading('btn-resolve', () => {
    commitment.status = outcome;
    showToast(`Dispute on Commitment #${id} resolved as ${outcome}`, 'success');
    document.getElementById('resolve-arbitrator').value = '';
    document.getElementById('resolve-id').value = '';
    document.getElementById('resolve-outcome').value = '';
  });
}

function fetchArbitrator() {
  simulateLoading(null, () => {
    const el = document.getElementById('arbitrator-result');
    el.innerHTML = `
      <div class="detail-panel">
        <div class="detail-row">
          <span class="detail-key">Arbitrator</span>
          <span class="detail-val mono" style="font-size:11px;">${MOCK_ARBITRATOR}</span>
        </div>
      </div>
    `;
    showToast('Arbitrator address fetched', 'success');
  });
}

function fetchArbitratorPage() {
  simulateLoading(null, () => {
    const el = document.getElementById('init-arbitrator-result');
    el.innerHTML = `
      <div class="detail-panel">
        <div class="detail-row">
          <span class="detail-key">Arbitrator</span>
          <span class="detail-val mono" style="font-size:11px;">${MOCK_ARBITRATOR}</span>
        </div>
      </div>
    `;
    showToast('Arbitrator address fetched', 'success');
  });
}

// ── Reputation ────────────────────────────────────────────────
function submitReputation() {
  const address = document.getElementById('rep-address').value.trim();
  if (!address || !address.startsWith('G')) {
    showToast('Enter a valid Stellar address (starts with G)', 'error'); return;
  }

  simulateLoading('btn-rep', () => {
    // Calculate from mock data
    const issued = mockCommitments.filter(c => c.issuer === address);
    let fulfilled = issued.filter(c => c.status === 'Fulfilled').length;
    let late      = issued.filter(c => c.status === 'Late').length;
    let breached  = issued.filter(c => c.status === 'Breached').length;

    // Demo fallback if unknown address
    if (!issued.length) {
      fulfilled = Math.floor(Math.random() * 12) + 3;
      late      = Math.floor(Math.random() * 3);
      breached  = Math.floor(Math.random() * 2);
    }

    const total = fulfilled + late + breached;
    const rate  = total > 0 ? Math.round((fulfilled / total) * 100) : 0;

    document.getElementById('rep-fulfilled').textContent = fulfilled;
    document.getElementById('rep-late').textContent      = late;
    document.getElementById('rep-breached').textContent  = breached;
    document.getElementById('rep-rate').textContent      = `${rate}%`;
    document.getElementById('rep-progress').style.width  = `${rate}%`;
    document.getElementById('rep-score-num').textContent = rate;

    const ringFill = document.getElementById('ring-fill');
    const circumference = 251.2;
    const offset = circumference - (rate / 100) * circumference;
    ringFill.style.strokeDashoffset = offset;
    ringFill.style.stroke = rate >= 80 ? 'var(--text-primary)' : rate >= 50 ? 'var(--orange)' : 'var(--red)';

    let label, desc;
    if (rate >= 90) { label = 'Excellent'; desc = 'Consistently reliable — strong commitment track record.'; }
    else if (rate >= 75) { label = 'Good'; desc = 'Generally reliable with minor delays.'; }
    else if (rate >= 50) { label = 'Fair'; desc = 'Some inconsistency — proceed with caution.'; }
    else { label = 'Poor'; desc = 'Significant history of missed commitments.'; }

    document.getElementById('rep-score-label').textContent = label;
    document.getElementById('rep-score-desc').textContent  = desc;
    document.getElementById('rep-result-card').style.display = '';

    showToast('Reputation loaded', 'success');
  });
}

// ── Commitment Lookup ─────────────────────────────────────────
function submitLookup() {
  const id = parseInt(document.getElementById('lookup-id').value);
  if (!id || id < 1) {
    showToast('Enter a valid commitment ID', 'error'); return;
  }

  simulateLoading('btn-lookup', () => {
    const c = mockCommitments.find(m => m.id === id);
    if (!c) {
      showToast(`Commitment #${id} not found`, 'error');
      document.getElementById('lookup-result-card').style.display = 'none';
      return;
    }

    const statusCls = c.status.toLowerCase();
    const badge = document.getElementById('lookup-status-badge');
    badge.className = `badge ${statusCls}`;
    badge.innerHTML = `<span class="badge-dot"></span>${c.status}`;

    document.getElementById('lookup-details').innerHTML = `
      <div class="detail-row">
        <span class="detail-key">ID</span>
        <span class="detail-val">#${c.id}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Issuer</span>
        <span class="detail-val mono">${c.issuer}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Counterparty</span>
        <span class="detail-val mono">${c.counterparty}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Terms Hash</span>
        <span class="detail-val mono">${c.terms_hash}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Due At</span>
        <span class="detail-val">${fmtDateFull(c.due_at)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Created At</span>
        <span class="detail-val">${fmtDateFull(c.created_at)}</span>
      </div>
      ${c.attested_at ? `
      <div class="detail-row">
        <span class="detail-key">Attested At</span>
        <span class="detail-val">${fmtDateFull(c.attested_at)}</span>
      </div>` : ''}
    `;

    document.getElementById('lookup-result-card').style.display = '';
    showToast(`Commitment #${id} loaded`, 'success');
  });
}

function submitIsOverdue() {
  const id = parseInt(document.getElementById('lookup-id').value);
  if (!id) { showToast('Enter a commitment ID first', 'error'); return; }
  const c = mockCommitments.find(m => m.id === id);
  if (!c) { showToast(`Commitment #${id} not found`, 'error'); return; }

  const now = Math.floor(Date.now() / 1000);
  const overdue = c.status === 'Pending' && now > c.due_at;
  showToast(
    overdue ? `Commitment #${id} is OVERDUE` : `Commitment #${id} is not overdue`,
    overdue ? 'warning' : 'success'
  );
}

// ── Initialize ────────────────────────────────────────────────
function submitInitialize() {
  const arbitrator = document.getElementById('init-arbitrator').value.trim();
  if (!arbitrator || !arbitrator.startsWith('G')) {
    showToast('Enter a valid Stellar arbitrator address', 'error'); return;
  }
  simulateLoading('btn-init', () => {
    showToast('Contract already initialized on Testnet', 'warning');
  });
}

// ── Modal ─────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}

// Close on overlay click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
    document.body.style.overflow = '';
  }
});

// ── Toast ─────────────────────────────────────────────────────
function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8.5l3.5 3.5 7.5-7.5"/></svg>`,
    error:   `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 1l14 14M15 1L1 15"/></svg>`,
    warning: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2L1 14h14L8 2z"/><path d="M8 6v4"/></svg>`,
    default: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 6v4"/></svg>`,
  };

  toast.innerHTML = `${icons[type] || icons.default}<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toast-out 0.25s ease forwards';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

// ── Loading Simulation ────────────────────────────────────────
function simulateLoading(btnId, callback, delay = 900) {
  const btn = btnId ? document.getElementById(btnId) : null;
  if (btn) {
    btn.classList.add('loading');
    btn.disabled = true;
  }
  setTimeout(() => {
    if (btn) {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
    callback();
  }, delay + Math.random() * 400);
}

// ── Helpers ───────────────────────────────────────────────────
function shortAddr(addr) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function fmtDate(ts) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 0) {
    const futureDiff = -diff;
    if (futureDiff < 86400) return `in ${Math.floor(futureDiff / 3600)}h`;
    return `in ${Math.floor(futureDiff / 86400)}d`;
  }
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDateFull(ts) {
  return new Date(ts * 1000).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function simpleHash(str) {
  // Deterministic mock hash for demo
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `${hex}${hex}${hex}${hex}`.slice(0, 62) + '00';
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  navigate('dashboard');
});
