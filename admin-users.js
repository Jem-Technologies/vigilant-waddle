/* Admin Users JS (external, ID-compatible) */
/* global fetch, document, CustomEvent, crypto */

// ---------- config ----------
const API = ''; // same origin. If different origin, set e.g. 'https://api.yoursite.com';
const api = (p) => API + p;

// ---------- small helpers ----------
const $ = (id) => document.getElementById(id);
const qq = (sel, root=document) => root.querySelector(sel);
function firstId(...ids){ for (const id of ids){ const el=$(id); if (el) return el; } return null; }
function escapeHtml(s){ return (s ?? '').toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// Enhanced fetch helper (shows JSON or first 500 chars of non-JSON)
async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts });
  const ct = res.headers.get('content-type') || '';
  let data = null, text = '';
  try {
    if (ct.includes('application/json')) data = await res.json();
    else { text = await res.text(); try{ data = JSON.parse(text); }catch{} }
  } catch {}
  if (!res.ok) {
    const msg = (data && (data.error || data.detail || data.message)) || text?.slice(0,500) || `HTTP ${res.status}`;
    throw new Error(`${url}: ${msg}`);
  }
  return data ?? {};
}

// ---------- toast ----------
const toastEl = $('toast');
function toast(msg){ if(!toastEl){ alert(msg); return; } toastEl.textContent = msg; toastEl.classList.add('show'); setTimeout(()=>toastEl.classList.remove('show'), 2200); }

// ---------- modal utils ----------
function openModal(id) {
  const el = $(id);
  if (!el) return;
  el.setAttribute('aria-hidden', 'false');
  // focus first focusable
  setTimeout(() => {
    const f = el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    f?.focus();
  }, 0);
}
function closeModal(id) {
  const el = $(id);
  if (!el) return;
  el.setAttribute('aria-hidden', 'true');
}
// generic open/close via data attributes
document.addEventListener('click', (e) => {
  const openId = e.target?.dataset?.open;
  const closeId = e.target?.dataset?.close;
  if (openId) openModal(openId);
  if (closeId) closeModal(closeId);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal[aria-hidden="false"]').forEach(m => m.setAttribute('aria-hidden', 'true'));
  }
});

// ---------- multi-select factory (legacy dropdown support) ----------
function buildMultiSelect(rootEl, items, { onChange } = {}) {
  const menu = rootEl.querySelector('.ms-menu');
  if (!menu) return null;
  menu.innerHTML = '';
  const state = new Set();

  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'opt';
    row.setAttribute('role','option');
    row.dataset.id = String(it.id);
    row.innerHTML = `
      <input type="checkbox" aria-label="${escapeHtml(it.label)}">
      <div>
        <div>${escapeHtml(it.label)}</div>
        ${it.sublabel ? `<div class="muted">${escapeHtml(it.sublabel)}</div>` : ''}
      </div>`;
    row.addEventListener('click', () => {
      const cb = row.querySelector('input[type="checkbox"]');
      cb.checked = !cb.checked;
      if (cb.checked) state.add(String(it.id)); else state.delete(String(it.id));
      onChange?.(state);
      updateCount();
    });
    menu.appendChild(row);
  }

  function updateCount(){
    const countEl = rootEl.querySelector('.count span');
    if (countEl) countEl.textContent = state.size;
  }

  rootEl.addEventListener('click', (e)=>{
    if (e.target.closest('.ms-trigger')) {
      const open = rootEl.getAttribute('aria-expanded') === 'true';
      rootEl.setAttribute('aria-expanded', open ? 'false' : 'true');
      const menu = rootEl.querySelector('.ms-menu');
      if (menu) menu.hidden = open;
    }
  });
  document.addEventListener('click', (e)=>{
    if (!rootEl.contains(e.target)) {
      rootEl.setAttribute('aria-expanded', 'false');
      const menu = rootEl.querySelector('.ms-menu');
      if (menu) menu.hidden = true;
    }
  });

  return {
    getSelected: () => Array.from(state),
    setSelected: (ids=[]) => {
      state.clear(); ids.forEach(id => state.add(String(id)));
      for (const row of menu.querySelectorAll('.opt')) {
        const cb = row.querySelector('input[type="checkbox"]');
        cb.checked = state.has(row.dataset.id);
      }
      updateCount();
    }
  };
}

// ---------- state ----------
let groupsMS = null, permsMS = null; // legacy dropdowns (if present)
const state = {
  groups: [],        // from API
  permissions: [],   // from API
  selectedGroupIds: new Set(),
  selectedPermIds: new Set(),
};

// hidden inputs for modal-selected ids (exist in modal HTML)
const hfGroupIds = $('hfGroupIds');
const hfPermIds  = $('hfPermIds');

// small modal lists (if present)
const groupsListEl = $('groupsList');
const permsListEl  = $('permsList');
const groupsCountEl = $('groupsCount');
const permsCountEl  = $('permsCount');

// ---------- load data ----------
async function loadGroups(){
  // Accept either {groups:[...]} or plain array
  const data = await fetchJSON(api('/api/groups'));
  const groups = Array.isArray(data) ? data : (data.groups || data.results || []);
  state.groups = Array.isArray(groups) ? groups : [];
  // legacy dropdown support
  const root = firstId('ufGroupsMS','groupsMS');
  if (root) {
    const items = state.groups.map(g => ({ id: g.id, label: g.name }));
    groupsMS = buildMultiSelect(root, items, { onChange: ()=>{} });
  }
  // small modal rendering if element exists
  if (groupsListEl) renderGroupsList();
}

async function loadPermissions(){
  // Accept either {permissions:[...]} or plain array
  const data = await fetchJSON(api('/api/permissions'));
  const perms = Array.isArray(data) ? data : (data.permissions || data.results || []);
  state.permissions = Array.isArray(perms) ? perms : [];
  // legacy dropdown support
  const root = firstId('ufPermsMS','permsMS');
  if (root) {
    const items = state.permissions.map(p => ({ id: p.id, label: p.key || p.name || p.id, sublabel: p.description }));
    permsMS = buildMultiSelect(root, items, { onChange: ()=>{} });
  }
  // small modal rendering if element exists
  if (permsListEl) renderPermsList();
}

// ---------- renderers for small modals ----------
function renderGroupsList() {
  if (!groupsListEl) return;
  const sel = state.selectedGroupIds;
  groupsListEl.innerHTML = '';
  state.groups.forEach(g => {
    const row = document.createElement('div');
    row.className = 'row';
    const id = `g_${g.id}`;
    row.innerHTML = `
      <label for="${id}">
        <input type="checkbox" id="${id}" value="${g.id}" ${sel.has(g.id) ? 'checked' : ''}>
        <span>${escapeHtml(g.name || 'Untitled Group')}</span>
      </label>
      ${g.department_name ? `<small>Dept: ${escapeHtml(g.department_name)}</small>` : ''}
    `;
    groupsListEl.appendChild(row);
  });
}
function renderPermsList() {
  if (!permsListEl) return;
  const sel = state.selectedPermIds;
  permsListEl.innerHTML = '';
  state.permissions.forEach(p => {
    const row = document.createElement('div');
    row.className = 'row';
    const id = `p_${p.id}`;
    const title = p.key || p.name || p.id;
    row.innerHTML = `
      <label for="${id}">
        <input type="checkbox" id="${id}" value="${p.id}" ${sel.has(p.id) ? 'checked' : ''}>
        <span>${escapeHtml(title)}</span>
      </label>
      ${p.description ? `<small>${escapeHtml(p.description)}</small>` : ''}
    `;
    permsListEl.appendChild(row);
  });
}

// ---------- users table ----------
async function loadUsers(){
  const tbody = qq('#usersTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const users = await fetchJSON(api('/api/admin/users'));

  // Detect legacy vs expanded table by header text
  const th2 = qq('#usersTable thead th:nth-child(2)');
  const hasEmailCol = th2 && /email/i.test(th2.textContent || '');

  if (!users.length) {
    const empty = $('emptyState') || $('usersSummary');
    if (empty) { empty.style.display = 'block'; empty.textContent = 'No users yet'; }
    return;
  }
  const maybeHide = $('emptyState');
  if (maybeHide) maybeHide.style.display = 'none';

  for (const u of users) {
    const tr = document.createElement('tr');
    if (hasEmailCol) {
      // Expanded: Name, Email, Role, Groups(count), Permissions(count), Password(reset), Actions
      tr.innerHTML = `
        <td>${escapeHtml(u.name || '')}</td>
        <td>${escapeHtml(u.email || '')}</td>
        <td><span class="pill">${escapeHtml(u.role || 'Member')}</span></td>
        <td><span class="pill" title="Groups">${Number(u.group_count||0)}</span></td>
        <td><span class="pill" title="Permissions">${Number(u.perm_count||0)}</span></td>
        <td><button class="btn sm" data-act="reset-pwd" data-id="${u.id}">Reset</button></td>
        <td>
          <button class="btn sm" data-act="edit" data-id="${u.id}">Edit</button>
          <button class="btn sm" data-act="disable" data-id="${u.id}">Disable</button>
        </td>`;
    } else {
      // Legacy: Name, Role, Privileges(count), Actions
      tr.innerHTML = `
        <td>${escapeHtml(u.name || '')}</td>
        <td><span class="pill">${escapeHtml(u.role || 'Member')}</span></td>
        <td><span class="pill" title="Permissions">${Number(u.perm_count||0)}</span></td>
        <td>
          <button class="btn sm" data-act="reset-pwd" data-id="${u.id}">Reset</button>
          <button class="btn sm" data-act="edit" data-id="${u.id}">Edit</button>
          <button class="btn sm" data-act="disable" data-id="${u.id}">Disable</button>
        </td>`;
    }
    tbody.appendChild(tr);
  }
}

// ---------- create user ----------
async function createUser(){
  const nameEl     = firstId('ufName','name');
  const emailEl    = firstId('ufEmail','email');
  const passwordEl = firstId('ufPassword','password');
  const roleEl     = firstId('ufRole','role');

  const name = nameEl?.value.trim();
  const email = emailEl?.value.trim().toLowerCase();
  const password = passwordEl?.value || '';
  const role = roleEl?.value || 'Member';

  if (!email) { toast('Email is required'); return; }
  if (!name) { toast('Name is required'); return; }

  // Prefer modal selections (hidden inputs). If not present, fall back to legacy dropdowns.
  let group_ids = [];
  let permission_ids = [];
  if (hfGroupIds && hfPermIds) {
    try { group_ids = JSON.parse(hfGroupIds.value || '[]'); } catch {}
    try { permission_ids = JSON.parse(hfPermIds.value || '[]'); } catch {}
  } else {
    group_ids = groupsMS?.getSelected() || [];
    permission_ids = permsMS?.getSelected() || [];
  }

  const payload = {
    name,
    email,
    role,
    group_ids,
    // only pass permission_ids if role is Custom (to avoid creating a custom role unintentionally)
    permission_ids: (role === 'Custom') ? permission_ids : []
  };
  if (password) payload.password = password;

  await fetchJSON(api('/api/admin/users'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  toast('User created');
  resetForm();
  // close base modal if present
  if ($('userModal')) closeModal('userModal');
  await loadUsers();
}

function resetForm(){
  const nameEl     = firstId('ufName','name');
  const emailEl    = firstId('ufEmail','email');
  const passwordEl = firstId('ufPassword','password');
  const roleEl     = firstId('ufRole','role');
  if (nameEl) nameEl.value = '';
  if (emailEl) emailEl.value = '';
  if (passwordEl) passwordEl.value = '';
  if (roleEl) roleEl.value = 'Member';
  groupsMS?.setSelected?.([]);
  permsMS?.setSelected?.([]);
  if (hfGroupIds) hfGroupIds.value = '[]';
  if (hfPermIds)  hfPermIds.value  = '[]';
  if (groupsCountEl) groupsCountEl.textContent = '0';
  if (permsCountEl)  permsCountEl.textContent  = '0';
}

// ---------- create group / department & push to Chats ----------
async function createGroup(){
  const input = firstId('newGroupName');
  if (!input) return toast('Group input not found');
  const name = input.value.trim();
  if (!name) return toast('Group name required');
  const res = await fetchJSON(api('/api/groups'), {
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name })
  });
  input.value = '';
  toast('Group created');
  await loadGroups(); // refresh lists
  window.dispatchEvent(new CustomEvent('org-structure-updated', { detail:{ type:'group', id: res?.group?.id, thread: res?.chat_thread_id }}));
}

async function createDepartment(){
  const input = firstId('newDeptName');
  if (!input) return toast('Department input not found');
  const name = input.value.trim();
  if (!name) return toast('Department name required');
  const res = await fetchJSON(api('/api/departments'), {
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name })
  });
  input.value = '';
  toast('Department created');
  window.dispatchEvent(new CustomEvent('org-structure-updated', { detail:{ type:'department', id: res?.department?.id, thread: res?.chat_thread_id }}));
}

// ---------- password helpers ----------
function randomPassword(len=12){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*?';
  let out = '';
  for (let i=0;i<len;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}

// ---------- wire up ----------
firstId('createBtn')?.addEventListener('click', createUser);
firstId('resetFormBtn')?.addEventListener('click', resetForm);
firstId('createGroupBtn')?.addEventListener('click', createGroup);
firstId('createDeptBtn')?.addEventListener('click', createDepartment);

// Legacy “open form” button (shows inline form) — now opens modal if present
$('btnAddUser')?.addEventListener('click', async ()=>{
  if ($('userModal')) {
    // reset + open modal
    resetForm();
    openModal('userModal');
  } else {
    // fallback to inline form visibility
    const form = $('userForm');
    if (form) form.hidden = false;
  }
  await Promise.all([loadGroups(), loadPermissions()]);
});

// Cancel hides modal or inline form
$('btnCancelUser')?.addEventListener('click', ()=>{
  resetForm();
  if ($('userModal')) closeModal('userModal');
  const form = $('userForm');
  if (form) form.hidden = true;
});

// Generate password (supports either id)
firstId('genPwdBtn','btnGenPass')?.addEventListener('click', ()=>{
  const el = firstId('password','ufPassword');
  if (!el) return;
  el.value = randomPassword();
});

// Toggle password visibility if you have a toggle button
firstId('togglePwdBtn')?.addEventListener('click', ()=>{
  const f = firstId('password','ufPassword');
  if (!f) return;
  f.type = (f.type === 'password') ? 'text' : 'password';
});

// Table action handlers
qq('#usersTable tbody')?.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;

  if (act === 'reset-pwd') {
    const newPwd = prompt('Enter new password (leave empty to cancel):');
    if (!newPwd) return;
    await fetchJSON(api('/api/admin/users'), {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ id, password: newPwd })
    });
    toast('Password updated');
  } else if (act === 'edit') {
    toast('Edit coming soon');
  } else if (act === 'disable') {
    toast('Disable coming soon');
  }
});

// Small modals: opening hooks populate current selections
$('btnPickGroups')?.addEventListener('click', async () => {
  // hydrate from hidden input (modal flow)
  if (hfGroupIds) {
    try { state.selectedGroupIds = new Set(JSON.parse(hfGroupIds.value || '[]')); } catch { state.selectedGroupIds = new Set(); }
  }
  if (!state.groups.length) await loadGroups();
  else renderGroupsList();
  openModal('groupsModal');
});
$('btnPickPerms')?.addEventListener('click', async () => {
  if (hfPermIds) {
    try { state.selectedPermIds = new Set(JSON.parse(hfPermIds.value || '[]')); } catch { state.selectedPermIds = new Set(); }
  }
  if (!state.permissions.length) await loadPermissions();
  else renderPermsList();
  openModal('permsModal');
});

// Save selections from small modals
$('saveGroupsBtn')?.addEventListener('click', () => {
  if (!groupsListEl) return closeModal('groupsModal');
  const chosen = [...groupsListEl.querySelectorAll('input[type="checkbox"]:checked')].map(c => c.value);
  state.selectedGroupIds = new Set(chosen);
  if (hfGroupIds) hfGroupIds.value = JSON.stringify(chosen);
  if (groupsCountEl) groupsCountEl.textContent = String(chosen.length);
  closeModal('groupsModal');
});
$('savePermsBtn')?.addEventListener('click', () => {
  if (!permsListEl) return closeModal('permsModal');
  const chosen = [...permsListEl.querySelectorAll('input[type="checkbox"]:checked')].map(c => c.value);
  state.selectedPermIds = new Set(chosen);
  if (hfPermIds) hfPermIds.value = JSON.stringify(chosen);
  if (permsCountEl) permsCountEl.textContent = String(chosen.length);
  closeModal('permsModal');
});

// Chats panel can listen for updates:
// window.addEventListener('org-structure-updated', (e)=> ChatPanel.reload());

// ---------- boot ----------
(async function init(){
  try {
    await Promise.all([loadGroups(), loadPermissions()]);
    await loadUsers();
  } catch (e) {
    console.error(e);
    toast('Failed to load admin data');
  }
})();

// ---------- Public API to open Add User modal with optional prefill ----------
window.openAddUserModal = function(prefill = {}) {
  resetForm();
  if (prefill.name)  $('ufName')?.value  = prefill.name;
  if (prefill.email) $('ufEmail')?.value = prefill.email;
  if (prefill.role)  $('ufRole')?.value  = prefill.role;
  if ($('userModal')) openModal('userModal');
};
