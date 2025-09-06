/* Admin Users JS (external, ID-compatible) */
/* global fetch, document, CustomEvent, crypto */

// ---------- config ----------
const API = ''; // same origin. If different origin, set e.g. 'https://api.yoursite.com';
const api = (p) => API + p;

// ---------- small helpers ----------
const $  = (id) => document.getElementById(id);
const qq = (sel, root=document) => root.querySelector(sel);
function firstId(...ids){ for (const id of ids){ const el=$(id); if (el) return el; } return null; }
function escapeHtml(s){ return (s ?? '').toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// ---------- safe fetch helper ----------
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
function toast(msg){
  if(!toastEl){ alert(msg); return; }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(()=>toastEl.classList.remove('show'), 2200);
}

/* ========================================================================== */
/* Multi-select (Groups / Permissions) — supports either:
   (A) <details class="ms"><summary class="ms-trigger">…</summary><div class="ms-menu">…</div></details>
   (B) <div class="ms"><button class="ms-trigger">…</button><div class="ms-menu">…</div></div>
   Uses pointerdown + capture to avoid “blink close” from global handlers. */
/* ========================================================================== */
function buildMultiSelect(rootEl, items) {
  if (!rootEl) return null;

  const isDetails = rootEl.tagName.toLowerCase() === 'details';
  const trigger   = rootEl.querySelector('.ms-trigger');
  const menu      = rootEl.querySelector('.ms-menu');
  const countEl   = rootEl.querySelector('.count span');

  // reset options
  menu.innerHTML = '';

  // rows
  for (const it of items) {
    const id  = String(it.id);
    const cid = `${rootEl.id}_${id}`;

    const row = document.createElement('div');
    row.className = 'opt';
    row.setAttribute('role','option');
    row.dataset.id = id;

    row.innerHTML = `
      <label for="${cid}" class="opt-row" style="display:flex;align-items:center;gap:10px;cursor:pointer">
        <input id="${cid}" type="checkbox" value="${id}">
        <div>
          <div>${escapeHtml(it.label || id)}</div>
          ${it.sublabel ? `<div class="muted" style="font-size:12px">${escapeHtml(it.sublabel)}</div>` : ''}
        </div>
      </label>
    `;

    const cb = row.querySelector('input[type="checkbox"]');
    cb.addEventListener('change', updateCount);

    // click anywhere on row toggles checkbox
    row.addEventListener('click', (e) => {
      if (!e.target.closest('input')) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      }
    });

    menu.appendChild(row);
  }

  // toggling for non-<details> flavor
  let open = false;
  if (!isDetails) {
    // baseline hidden state on div.ms flavor
    rootEl.setAttribute('aria-expanded', 'false');
    menu.hidden = true;

    const openMenu  = () => { if (open) return; open = true;  rootEl.setAttribute('aria-expanded','true');  menu.hidden = false;  menu.querySelector('input')?.focus({ preventScroll:true }); };
    const closeMenu = () => { if (!open) return; open = false; rootEl.setAttribute('aria-expanded','false'); menu.hidden = true; };

    // prevent outside “click to close” from seeing the open click
    trigger?.addEventListener('pointerdown', (e)=>{ e.preventDefault(); e.stopPropagation(); open ? closeMenu() : openMenu(); }, { capture:true });
    menu.addEventListener('pointerdown', (e)=>{ e.stopPropagation(); }, { capture:true });
    document.addEventListener('pointerdown', (e)=>{ if (!rootEl.contains(e.target)) closeMenu(); });
    trigger?.addEventListener('keydown', (e)=>{ if (['Enter',' ','ArrowDown'].includes(e.key)){ e.preventDefault(); openMenu(); }});
    rootEl.addEventListener('keydown', (e)=>{ if (e.key === 'Escape'){ e.stopPropagation(); closeMenu(); trigger?.focus(); }});
  } else {
    // <details> flavor: count updates on toggle too
    rootEl.addEventListener('toggle', updateCount);
  }

  function updateCount() {
    const n = menu.querySelectorAll('input[type="checkbox"]:checked').length;
    if (countEl) countEl.textContent = String(n);
  }
  // initial count
  updateCount();

  return {
    getSelected: () => Array.from(menu.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value),
    setSelected: (ids = []) => {
      const want = new Set(ids.map(String));
      menu.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = want.has(cb.value));
      updateCount();
    }
  };
}

/* ---------- loaders ---------- */
let groupsMS, permsMS;

async function loadGroups(){
  const data = await fetchJSON(api('/api/groups'));
  const list = Array.isArray(data) ? data : (data.groups || data.results || []);
  const items = list.map(g => ({
    id: g.id,
    label: g.name,
    sublabel: g.department_name ? `Dept: ${g.department_name}` : ''
  }));
  const root = $('ufGroupsMS');
  if (root) groupsMS = buildMultiSelect(root, items);
}

async function loadPermissions(){
  const data = await fetchJSON(api('/api/permissions'));
  const list = Array.isArray(data) ? data : (data.permissions || data.results || []);
  const items = list.map(p => ({
    id: p.id,
    label: p.key || p.name || p.id,
    sublabel: p.description || ''
  }));
  const root = $('ufPermsMS');
  if (root) permsMS = buildMultiSelect(root, items);
}

// optional: dynamic roles list (labels only)
async function loadRoles(){
  const sel = $('ufRole');
  if (!sel) return;
  try {
    const data = await fetchJSON(api('/api/roles'));
    const roles = Array.isArray(data) ? data : (data.roles || data.results || []);
    if (!Array.isArray(roles) || !roles.length) return;
    const cur = sel.value || 'Member';
    sel.innerHTML = roles.map(r =>
      `<option value="${escapeHtml(r.name || 'Member')}">${escapeHtml(r.name || 'Member')}</option>`
    ).join('');
    if (![...sel.options].some(o=>o.value==='Custom')) {
      sel.insertAdjacentHTML('beforeend', `<option value="Custom">Custom</option>`);
    }
    if ([...sel.options].some(o=>o.value===cur)) sel.value = cur;
  } catch (e) {
    console.warn('loadRoles:', e?.message || e);
  }
}

/* ========================================================================== */
/* Users table                                                                */
/* ========================================================================== */
let usersIndex = new Map();

async function loadUsers(){
  const tbody = qq('#usersTable tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  const users = await fetchJSON(api('/api/admin/users'));

  const th2 = qq('#usersTable thead th:nth-child(2)');
  const hasEmailCol = th2 && /email/i.test(th2.textContent || '');

  if (!users.length) {
    const empty = $('emptyState') || $('usersSummary');
    if (empty) { empty.style.display = 'block'; empty.textContent = 'No users yet'; }
    return;
  }
  const maybeHide = $('emptyState');
  if (maybeHide) maybeHide.style.display = 'none';

  usersIndex = new Map();

  for (const u of users) {
    usersIndex.set(u.id, u);

    // permission keys for preview
    let keys = [];
    try { keys = JSON.parse(u.perms_json || '[]'); } catch {}
    const count = Number(u.perm_count || keys.length || 0);

    const keyBadges = keys.map(k => `<code class="perm-key">${escapeHtml(k)}</code>`).join(' ');
    const keyPanel  = keyBadges || '<span class="muted">No permissions</span>';

    const tr = document.createElement('tr');
    tr.dataset.id = u.id;

    if (hasEmailCol) {
      tr.innerHTML = `
        <td>${escapeHtml(u.name || '')}</td>
        <td>${escapeHtml(u.email || '')}</td>
        <td><span class="pill">${escapeHtml(u.role || 'Member')}</span></td>
        <td><span class="pill" title="Groups">${Number(u.group_count||0)}</span></td>
        <td class="perm-cell">
          <details class="perm-dd">
            <summary><span class="pill">${count}</span></summary>
            <div class="perm-list">${keyPanel}</div>
          </details>
        </td>
        <td><button class="btn sm" data-act="reset-pwd" data-id="${u.id}">Reset</button></td>
        <td>
          <button class="btn sm" data-act="edit" data-id="${u.id}">Edit</button>
          <button class="btn sm" data-act="disable" data-id="${u.id}">Disable</button>
        </td>`;
    } else {
      tr.innerHTML = `
        <td>${escapeHtml(u.name || '')}</td>
        <td><span class="pill">${escapeHtml(u.role || 'Member')}</span></td>
        <td class="perm-cell">
          <details class="perm-dd">
            <summary><span class="pill">${count}</span></summary>
            <div class="perm-list">${keyPanel}</div>
          </details>
        </td>
        <td>
          <button class="btn sm" data-act="reset-pwd" data-id="${u.id}">Reset</button>
          <button class="btn sm" data-act="edit" data-id="${u.id}">Edit</button>
          <button class="btn sm" data-act="disable" data-id="${u.id}">Disable</button>
        </td>`;
    }
    tbody.appendChild(tr);
  }
}

/* ========================================================================== */
/* Edit user                                                                  */
/* ========================================================================== */
async function openEditUser(u) {
  // ensure lists exist before we preselect
  await Promise.all([loadGroups(), loadPermissions()]);

  const dlg = $('addUserModal');
  dlg?.showModal?.();

  const formEl = $('userForm');
  if (formEl) formEl.dataset.editing = u.id;

  // fill fields
  $('ufName').value  = u.name  || '';
  $('ufEmail').value = u.email || '';
  $('ufRole').value  = u.role  || 'Member';

  // preselect Permissions by ids
  let permIds = [];
  try { permIds = JSON.parse(u.perm_ids_json || '[]'); } catch {}
  permsMS?.setSelected(permIds);

  // preselect Groups by ids (when available)
  let groupIds = [];
  try { groupIds = JSON.parse(u.group_ids_json || '[]'); } catch {}
  groupsMS?.setSelected(groupIds);

  setTimeout(()=> $('ufName')?.focus(), 0);
}

/* ========================================================================== */
/* Create / Update user                                                       */
/* ========================================================================== */
async function createUser(){
  const nameEl     = firstId('ufName','name');
  const emailEl    = firstId('ufEmail','email');
  const passwordEl = firstId('ufPassword','password');
  const roleEl     = firstId('ufRole','role');

  const name     = nameEl?.value.trim();
  const email    = emailEl?.value.trim().toLowerCase();
  const password = passwordEl?.value || '';
  const role     = roleEl?.value || 'Member';

  if (!email) { toast('Email is required'); return; }
  if (!name)  { toast('Name is required');  return; }

  const group_ids      = groupsMS?.getSelected() || [];
  const permission_ids = permsMS?.getSelected()  || []; // ALWAYS send picked perms

  const payload = { name, email, role, group_ids, permission_ids };
  if (password) payload.password = password;

  // include id when editing
  const editingId = $('userForm')?.dataset?.editing;
  if (editingId) payload.id = editingId;

  await fetchJSON(api('/api/admin/users'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  toast(editingId ? 'User updated' : 'User created');
  $('addUserModal')?.close();
  resetForm();
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
  const formEl = $('userForm'); if (formEl) formEl.dataset.editing = '';
  permsMS?.setSelected([]);
  groupsMS?.setSelected([]);
}

/* ========================================================================== */
/* Create Group / Department (and notify Chats)                               */
/* ========================================================================== */
async function createGroup(){
  const input = $('newGroupName');
  if (!input) return toast('Group input not found');
  const name = input.value.trim();
  if (!name) return toast('Group name required');
  const res = await fetchJSON(api('/api/groups'), {
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name })
  });
  input.value = '';
  toast('Group created');
  await loadGroups(); // refresh dropdown
  window.dispatchEvent(new CustomEvent('org-structure-updated', { detail:{ type:'group', id: res?.group?.id, thread: res?.chat_thread_id }}));
}

async function createDepartment(){
  const input = $('newDeptName');
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

/* ========================================================================== */
/* Password helper                                                            */
/* ========================================================================== */
function randomPassword(len=12){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*?';
  let out = '';
  for (let i=0;i<len;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}

/* ========================================================================== */
/* Wire-up                                                                    */
/* ========================================================================== */
const addUserDlg = $('addUserModal');

firstId('createBtn')?.addEventListener('click', createUser);
firstId('resetFormBtn')?.addEventListener('click', resetForm);
firstId('createGroupBtn')?.addEventListener('click', createGroup);
firstId('createDeptBtn')?.addEventListener('click', createDepartment);

// Open dialog (load lists fresh so newest groups/permissions appear)
$('btnAddUser')?.addEventListener('click', async ()=>{
  await Promise.all([loadGroups(), loadPermissions(), loadRoles()]);
  addUserDlg?.showModal?.();
  setTimeout(()=> $('ufName')?.focus(), 0);
});

// Close dialog on Cancel
$('btnCancelUser')?.addEventListener('click', ()=>{
  resetForm();
  addUserDlg?.close?.();
});

// Generate password
firstId('genPwdBtn','btnGenPass')?.addEventListener('click', ()=>{
  const el = firstId('password','ufPassword');
  if (!el) return;
  el.value = randomPassword();
});

// Optional: click-outside-to-close for dialog
addUserDlg?.addEventListener('click', (e) => {
  const card = addUserDlg.querySelector('.modal-dialog');
  if (!card) return;
  const r = card.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (!inside) addUserDlg.close();
});

// Table actions
qq('#usersTable tbody')?.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id  = btn.dataset.id;

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
    const u = usersIndex.get(id);
    if (!u) { toast('User not found'); return; }
    await openEditUser(u);
  } else if (act === 'disable') {
    toast('Disable coming soon');
  }
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
