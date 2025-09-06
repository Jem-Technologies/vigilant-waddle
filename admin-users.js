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

function buildMultiSelect(rootEl, items) {
  if (!rootEl) return null;

  const menu    = rootEl.querySelector('.ms-menu');
  const countEl = rootEl.querySelector('.count span');

  // clear and rebuild options
  menu.innerHTML = '';
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

    // Click anywhere on the row toggles the checkbox
    row.addEventListener('click', (e) => {
      if (!e.target.closest('input')) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      }
    });

    menu.appendChild(row);
  }

  function updateCount() {
    const n = menu.querySelectorAll('input[type="checkbox"]:checked').length;
    if (countEl) countEl.textContent = String(n);
  }
  // initialize count
  updateCount();

  // expose API
  return {
    getSelected: () =>
      Array.from(menu.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value),
    setSelected: (ids = []) => {
      const want = new Set(ids.map(String));
      menu.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = want.has(cb.value));
      updateCount();
    }
  };
}

// Load and mount
let groupsMS, permsMS;

async function loadGroups(){
  const data = await fetchJSON('/api/groups');
  const list = Array.isArray(data) ? data : (data.groups || data.results || []);
  const items = list.map(g => ({ id: g.id, label: g.name, sublabel: g.department_name ? `Dept: ${g.department_name}` : '' }));
  const root = document.getElementById('ufGroupsMS');
  if (root) groupsMS = buildMultiSelect(root, items, { onChange: ()=>{} });
}

async function loadPermissions(){
  const data = await fetchJSON('/api/permissions');
  const list = Array.isArray(data) ? data : (data.permissions || data.results || []);
  const items = list.map(p => ({ id: p.id, label: p.key || p.name || p.id, sublabel: p.description || '' }));
  const root = document.getElementById('ufPermsMS');
  if (root) permsMS = buildMultiSelect(root, items, { onChange: ()=>{} });
}


async function loadRoles(){
  const sel = document.getElementById('ufRole');
  if (!sel) return;
  try {
    const data = await fetchJSON('/api/roles');
    const roles = Array.isArray(data) ? data : (data.roles || data.results || []);
    if (!Array.isArray(roles) || !roles.length) return; // keep built-in options

    const cur = sel.value || 'Member';
    sel.innerHTML = roles.map(r =>
      `<option value="${escapeHtml(r.name || 'Member')}">${escapeHtml(r.name || 'Member')}</option>`
    ).join('');
    // Ensure 'Custom' is present for permission picking
    if (!roles.find(r => String(r.name).toLowerCase() === 'custom')) {
      sel.insertAdjacentHTML('beforeend', `<option value="Custom">Custom</option>`);
    }
    if ([...sel.options].some(o=>o.value===cur)) sel.value = cur;
  } catch (e) {
    // If roles API fails, just keep the baked-in options
    console.warn('loadRoles:', e?.message || e);
  }
}

async function loadUsers(){
  const tbody = qq('#usersTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const users = await fetchJSON(api('/api/admin/users'));

  const th2 = qq('#usersTable thead th:nth-child(2)');
  const hasEmailCol = th2 && /email/i.test(th2.textContent || '');

  if (!users.length) {
    const empty = $('emptyState') || $('usersSummary');
    if (empty) empty.style.display = 'block', (empty.textContent = 'No users yet');
    return;
  }
  const maybeHide = $('emptyState');
  if (maybeHide) maybeHide.style.display = 'none';

  for (const u of users) {
    const tr = document.createElement('tr');
    if (hasEmailCol) {
      tr.innerHTML = `
        <td>${escapeHtml(u.name || '')}</td>
        <td>${escapeHtml(u.email || '')}</td>
        <td><span class="pill">${escapeHtml(u.role || 'Member')}</span></td>
        <td><span class="pill" title="Groups">${Number(u.group_count||0)}</span></td>
        <td><span class="pill" title="Permissions">${Number(u.perm_count||0)}</span></td>
        <td><button class="btn ${qq('.table')?.classList.contains('ghost')?'ghost':'sm'}" data-act="reset-pwd" data-id="${u.id}">Reset</button></td>
        <td>
          <button class="btn sm" data-act="edit" data-id="${u.id}">Edit</button>
          <button class="btn sm" data-act="disable" data-id="${u.id}">Disable</button>
        </td>`;
    } else {
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
  const group_ids = groupsMS?.getSelected() || [];
  const picked_permissions = permsMS?.getSelected() || [];
  const permission_ids = (role === 'Custom') ? picked_permissions : []; // avoid accidental custom roles

  if (!email) { toast('Email is required'); return; }
  if (!name) { toast('Name is required'); return; }

  const payload = { name, display_name: name, email, role, group_ids, permission_ids };
  if (password) payload.password = password;

  await fetchJSON(api('/api/admin/users'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  toast('User created');

  // close dialog and refresh
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
  groupsMS?.setSelected([]);
  permsMS?.setSelected([]);
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
  await loadGroups(); // refresh dropdown
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
const addUserDlg = $('addUserModal');

firstId('createBtn')?.addEventListener('click', createUser);
firstId('resetFormBtn')?.addEventListener('click', resetForm);
firstId('createGroupBtn')?.addEventListener('click', createGroup);
firstId('createDeptBtn')?.addEventListener('click', createDepartment);

// Open the dialog properly (load lists, focus first field)
$('btnAddUser')?.addEventListener('click', async ()=>{
  await Promise.all([loadGroups(), loadPermissions(), loadRoles(), loadUsers()]);
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

// Table action handlers (stubs for now)
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
