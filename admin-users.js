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

// ---------- multi-select factory ----------
function buildMultiSelect(rootEl, items, { onChange } = {}) {
  const menu = rootEl.querySelector('.ms-menu');
  menu.innerHTML = '';
  const state = new Set();

  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'opt';
    row.setAttribute('role','option');
    row.dataset.id = String(it.id);
    row.innerHTML = `
      <input type="checkbox" aria-label="${it.label}">
      <div>
        <div>${it.label}</div>
        ${it.sublabel ? `<div class="muted">${it.sublabel}</div>` : ''}
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
      // make it robust even if CSS is missing:
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

// ---------- populate dropdowns & table ----------
let groupsMS, permsMS;

async function loadGroups(){
  const { groups=[] } = await fetchJSON(api('/api/groups'));
  const items = groups.map(g => ({ id: g.id, label: g.name }));
  const root = firstId('ufGroupsMS','groupsMS');
  if (root) groupsMS = buildMultiSelect(root, items, { onChange: ()=>{} });
}

async function loadPermissions(){
  const { permissions=[] } = await fetchJSON(api('/api/permissions'));
  const items = permissions.map(p => ({ id: p.id, label: p.key, sublabel: p.description }));
  const root = firstId('ufPermsMS','permsMS');
  if (root) permsMS = buildMultiSelect(root, items, { onChange: ()=>{} });
}

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
    if (empty) empty.style.display = 'block', (empty.textContent = 'No users yet');
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
        <td><button class="btn ${qq('.table')?.classList.contains('ghost')?'ghost':'sm'}" data-act="reset-pwd" data-id="${u.id}">Reset</button></td>
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
  const group_ids = groupsMS?.getSelected() || [];
  const permission_ids = permsMS?.getSelected() || [];

  if (!email) { toast('Email is required'); return; }
  if (!name) { toast('Name is required'); return; }

  const payload = { name, display_name: name, email, role, group_ids, permission_ids };
  if (password) payload.password = password;

  await fetchJSON(api('/api/admin/users'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  document.getElementById('addUserModal')?.close();

  toast('User created');
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
firstId('createBtn')?.addEventListener('click', createUser);
firstId('resetFormBtn')?.addEventListener('click', resetForm);
firstId('createGroupBtn')?.addEventListener('click', createGroup);
firstId('createDeptBtn')?.addEventListener('click', createDepartment);

// Support your legacy "open form" and "cancel" buttons too:
const addUserDlg = document.getElementById('addUserModal');

$('btnAddUser')?.addEventListener('click', async ()=>{
  await Promise.all([loadGroups(), loadPermissions()]);
  addUserDlg?.showModal?.();
  setTimeout(()=> $('ufName')?.focus(), 0);
});

$('btnCancelUser')?.addEventListener('click', ()=>{
  resetForm();
  const addUserDlg = document.getElementById('addUserModal');
  addUserDlg?.close?.();
});

firstId('genPwdBtn','btnGenPass')?.addEventListener('click', ()=>{
  const el = firstId('password','ufPassword');
  if (!el) return;
  el.value = randomPassword();
});
firstId('togglePwdBtn')?.addEventListener('click', ()=>{
  const f = firstId('password','ufPassword');
  if (!f) return;
  f.type = (f.type === 'password') ? 'text' : 'password';
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
