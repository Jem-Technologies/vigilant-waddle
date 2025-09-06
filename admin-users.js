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

// ---------- multi-select factory (dropdown checkbox list) ----------
function buildMultiSelect(rootEl, items, { onChange } = {}) {
  if (!rootEl) return null;
  const menu = rootEl.querySelector('.ms-menu');
  const trigger = rootEl.querySelector('.ms-trigger');
  const countEl = rootEl.querySelector('.count span');

  // reset
  menu.innerHTML = '';
  rootEl.setAttribute('aria-expanded', 'false');
  menu.hidden = true;

  // build rows
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'opt';
    row.setAttribute('role','option');
    row.dataset.id = String(it.id);

    const cid = `${rootEl.id}_${it.id}`;
    row.innerHTML = `
      <label for="${cid}" class="opt-row" style="display:flex;align-items:center;gap:10px;cursor:pointer">
        <input id="${cid}" type="checkbox" value="${escapeHtml(String(it.id))}">
        <div>
          <div>${escapeHtml(it.label || String(it.id))}</div>
          ${it.sublabel ? `<div class="muted" style="font-size:12px">${escapeHtml(it.sublabel)}</div>` : ''}
        </div>
      </label>`;

    const cb = row.querySelector('input[type="checkbox"]');

    // checkbox toggling (single source of truth)
    cb.addEventListener('change', ()=>{
      updateCount();
      onChange?.();
    });

    // clicking row toggles checkbox unless you clicked the checkbox itself
    row.addEventListener('click', (e)=>{
      if (e.target.closest('input')) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change', { bubbles:false }));
    });

    menu.appendChild(row);
  }

  // toggle open/close
  const toggle = (open) => {
    rootEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    menu.hidden = !open;
    if (open) menu.querySelector('input[type="checkbox"]')?.focus({ preventScroll:true });
    else trigger?.focus({ preventScroll:true });
  };

  trigger?.addEventListener('click', (e)=>{
    e.stopPropagation();
    const open = rootEl.getAttribute('aria-expanded') === 'true';
    toggle(!open);
  });

  // close on outside click
  document.addEventListener('click', (e)=>{
    if (!rootEl.contains(e.target)) toggle(false);
  });

  // keyboard on trigger
  trigger?.addEventListener('keydown', (e)=>{
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); toggle(true);
    }
  });

  function updateCount(){
    const n = menu.querySelectorAll('input[type="checkbox"]:checked').length;
    if (countEl) countEl.textContent = String(n);
  }

  // API for the widget
  return {
    getSelected: () => Array.from(menu.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value),
    setSelected: (ids=[]) => {
      const want = new Set(ids.map(String));
      menu.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = want.has(cb.value));
      updateCount();
    },
    refresh: (newItems) => buildMultiSelect(rootEl, newItems, { onChange })
  };
}

// ---------- populate dropdowns & table ----------
let groupsMS, permsMS;

async function loadGroups(){
  const data = await fetchJSON(api('/api/groups'));
  const arr  = Array.isArray(data) ? data : (data.groups || data.results || []);
  const items = arr.map(g => ({ id: g.id, label: g.name, sublabel: g.department_name ? `Dept: ${g.department_name}` : '' }));
  const root = firstId('ufGroupsMS','groupsMS');
  if (root) groupsMS = buildMultiSelect(root, items, { onChange: ()=>{} });
}

async function loadPermissions(){
  const data = await fetchJSON(api('/api/permissions'));
  const arr  = Array.isArray(data) ? data : (data.permissions || data.results || []);
  const items = arr.map(p => ({ id: p.id, label: p.key || p.name || p.id, sublabel: p.description || '' }));
  const root = firstId('ufPermsMS','permsMS');
  if (root) permsMS = buildMultiSelect(root, items, { onChange: ()=>{} });
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
  await Promise.all([loadGroups(), loadPermissions()]);
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
