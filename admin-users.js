/* Admin Users — authoritative module for Admin → Users & Roles.
   - Renders the Users table with columns: Name | Roles | Permissions | Departments | Groups | Actions
   - Actions per row: Edit, Delete
   - Shows counts for Permissions / Departments / Groups; clicking opens a modal list.
   - Edit opens the existing #addUserModal populated with Name, Email, Role, Groups, Permissions, Departments.
   - Fetches live data from /api/* when available; falls back to localStorage with sensible seeds.
   - Admin users automatically "own" all groups/permissions/departments and always reflect newly created items.
*/

(() => {
  'use strict';

  // Take ownership so dashboard.js hands off rendering to this file
  window.__USE_ADMIN_USERS_JS = true;

  // -------------------- config --------------------
  const API = ''; // same origin; set to 'https://api.example.com' if different origin
  const api = (p) => API + p;

  // -------------------- helpers --------------------
  const $  = (id) => document.getElementById(id);
  const qq = (sel, root=document) => root.querySelector(sel);

  // HTML escape; also publish globally for any other bundles
  function escapeHtml(s) {
    return (s == null ? '' : String(s)).replace(/[&<>\"']/g, (c) => (
      c === '&' ? '&amp;' :
      c === '<' ? '&lt;'  :
      c === '>' ? '&gt;'  :
      c === '"' ? '&quot;': '&#39;'
    ));
  }
  if (!('escapeHtml' in globalThis)) globalThis.escapeHtml = escapeHtml;

  // fetch JSON with graceful parsing
  async function fetchJSON(url, opts = {}) {
    let res;
    try {
      res = await fetch(url, { credentials: 'include', ...opts });
    } catch (e) {
      throw new Error('NETWORK');
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    let data = null, text = '';
    try {
      if (ct.includes('application/json')) data = await res.json();
      else { text = await res.text(); try { data = JSON.parse(text); } catch {} }
    } catch {}
    if (!res.ok) {
      const msg = (data && (data.error || data.message || data.detail)) || text || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data ?? {};
  }

  // toast (uses #toast region in dashboard.html)
  function toast(msg, tone='') {
    const el = $('toast');
    if (!el) { console.log('[toast]', msg); return; }
    el.textContent = msg;
    el.className = `toast ${tone}`.trim();
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 2200);
  }

  // tiny utils
  const uid = () => (crypto?.randomUUID?.() || ('id_'+Math.random().toString(36).slice(2)));
  const tryParse = (s, d=[]) => { try { return JSON.parse(s); } catch { return d; } };

  // initials for avatar fallback
  function initials(nameOrEmail) {
    const s = (nameOrEmail || '').trim();
    if (!s) return '?';
    const parts = s.split(/\s+/);
    if (parts.length === 1 && s.includes('@')) return s[0].toUpperCase();
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }

// map "Original" (or "Account Original") to "Owner"
function roleDisplay(u) {
  const r = String(u?.role || '').trim();
  if (u?.is_owner === 1 || u?.is_owner === true) return 'Owner';
  if (/^original$/i.test(r) || /account\s*original/i.test(r) || /^owner$/i.test(r)) return 'Owner';
  return r || 'Member';
}


  // -------------------- local DB fallback --------------------
  const LS_KEY = 'admin_users_db_v1';
  function dbLoad() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || { users:[], groups:[], departments:[], permissions:[] }; }
    catch { return { users:[], groups:[], departments:[], permissions:[] }; }
  }
  function dbSave(db) { try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch {} }
  function seedIfEmpty() {
    const db = dbLoad();
    if (!db.permissions.length) {
      db.permissions = [
        { id:'users.read',  key:'users.read',  name:'Users: Read' },
        { id:'users.write', key:'users.write', name:'Users: Write' },
        { id:'groups.read', key:'groups.read', name:'Groups: Read' },
        { id:'groups.write',key:'groups.write',name:'Groups: Write' },
        { id:'billing.view',key:'billing.view',name:'Billing: View' },
        { id:'reports.view',key:'reports.view',name:'Reports: View' },
      ];
    }
    if (!db.departments.length) {
      db.departments = [
        { id:'dept-sales', name:'Sales' },
        { id:'dept-ops',   name:'Operations' },
        { id:'dept-hr',    name:'HR' },
      ];
    }
    if (!db.groups.length) {
      db.groups = [
        { id:'grp-ae',  name:'Account Execs', department_id:'dept-sales' },
        { id:'grp-sdr', name:'SDRs',          department_id:'dept-sales' },
        { id:'grp-it',  name:'IT',            department_id:'dept-ops'   },
      ];
    }
    if (!db.users.length) {
      db.users = [
        { id:uid(), name:'Admin User', email:'admin@example.com', role:'Admin', group_ids:[], dept_ids:[], perm_ids:[] },
        { id:uid(), name:'Member One', email:'member@example.com', role:'Member',
          group_ids:['grp-ae'], dept_ids:['dept-sales'], perm_ids:['users.read'] }
      ];
    }
    dbSave(db);
  }
  seedIfEmpty();

  // ---- caches and accessors ----
  let _groups = [], _depts = [], _perms = [];
  const allGroups = () => _groups.slice();
  const allDepts  = () => _depts.slice();
  const allPerms  = () => _perms.slice();

  function findGroupName(id) { return (_groups.find(g => String(g.id) === String(id)) || {}).name || String(id); }
  function findDeptName(id)  { return (_depts.find(d => String(d.id) === String(id)) || {}).name || String(id); }
  function findPermName(key) {
    const p = _perms.find(p => String(p.key || p.id) === String(key));
    return p ? (p.name || p.key || p.id) : String(key);
  }

  // -------------------- multi-select builder --------------------
  function buildMultiSelect(rootEl, items) {
    if (!rootEl) return null;
    const trigger = rootEl.querySelector('.ms-trigger');
    const menu    = rootEl.querySelector('.ms-menu');
    const countEl = rootEl.querySelector('.count span');

    menu.innerHTML = '';
    for (const it of items) {
      const id = String(it.id);
      const cid = `${rootEl.id}_${id}`;
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `
        <label for="${cid}">
          <input type="checkbox" id="${cid}" value="${escapeHtml(id)}" />
          <span class="label">
            <strong>${escapeHtml(it.label || it.name || id)}</strong>
            ${it.sublabel ? `<small>${escapeHtml(it.sublabel)}</small>` : ''}
          </span>
        </label>`;
      menu.appendChild(row);
    }

    function updateCount() {
      const n = menu.querySelectorAll('input[type="checkbox"]:checked').length;
      if (countEl) countEl.textContent = String(n);
    }
    menu.addEventListener('change', updateCount);
    updateCount();

    return {
      getSelected: () => Array.from(menu.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value),
      setSelected: (ids=[]) => {
        const want = new Set(ids.map(String));
        menu.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = want.has(cb.value));
        updateCount();
      }
    };
  }

  // -------------------- loaders (server + fallback) --------------------
  let groupsMS, permsMS, deptsMS;

  async function loadGroups() {
    try {
      const data = await fetchJSON(api('/api/groups'));
      const arr = Array.isArray(data) ? data : (data.groups || data.results || []);
      _groups = arr.map(g => ({
        id: g.id, name: g.name, department_id: g.department_id || g.dept_id || null,
        department_name: g.department_name || null
      }));
    } catch (e) {
      _groups = dbLoad().groups;
    }
    const items = _groups.map(g => ({
      id: g.id, label: g.name, sublabel: g.department_name ? `Dept: ${g.department_name}` : ''
    }));
    const root = $('ufGroupsMS');
    if (root) groupsMS = buildMultiSelect(root, items);
  }

  async function loadPermissions() {
    try {
      const data = await fetchJSON(api('/api/permissions'));
      const arr = Array.isArray(data) ? data : (data.permissions || data.results || []);
      _perms = arr.map(p => ({
        id: p.id ?? p.key,
        key: p.key ?? p.id,
        name: p.name ?? p.key ?? p.id,
        description: p.description || ''
      }));
    } catch (e) {
      _perms = dbLoad().permissions;
    }
    const items = _perms.map(p => ({
      id: p.key || p.id,
      label: p.name || p.key || p.id,
      sublabel: p.description || ''
    }));
    const root = $('ufPermsMS');
    if (root) permsMS = buildMultiSelect(root, items);
  }

  async function loadDepartments() {
    try {
      const data = await fetchJSON(api('/api/departments'));
      const arr = Array.isArray(data) ? data : (data.departments || data.results || []);
      _depts = arr.map(d => ({ id: d.id, name: d.name }));
    } catch (e) {
      _depts = dbLoad().departments;
    }
    const items = _depts.map(d => ({ id: d.id, label: d.name }));
    const root = $('ufDeptsMS');
    if (root) deptsMS = buildMultiSelect(root, items);
  }

  // -------------------- users handling --------------------
  let usersIndex = new Map();

  function expandForView(u) {
    // For Admins, always expose all
    if ((u.role || '').toLowerCase() === 'admin') {
      return {
        groups: allGroups().map(g => g.id),
        depts:  allDepts().map(d => d.id),
        perms:  allPerms().map(p => p.key || p.id)
      };
    }
    // otherwise take from user record (support several shapes)
    const groups = u.group_ids || u.groups || tryParse(u.group_ids_json) || [];
    const depts  = u.dept_ids  || u.departments || tryParse(u.dept_ids_json) || [];
    // permissions might be keys in u.perm_ids OR names in u.privileges; normalize to keys
    let perms = u.perm_ids || u.perm_keys || tryParse(u.perms_json) || u.privileges || [];
    perms = (perms || []).map(x => (typeof x === 'string' ? x : (x.key || x.id || x.name || ''))).filter(Boolean);
    return { groups, depts, perms };
  }

  async function ensureOrgDataLoaded() {
    if (!_groups?.length || !_depts?.length || !_perms?.length) {
      await Promise.all([loadGroups(), loadPermissions(), loadDepartments()]);
    }
  }

  async function loadUsers() {
    await ensureOrgDataLoaded();
    const tbody = qq('#usersTable tbody');
    if (!tbody) return;
    let users = [];
    try {
      const data = await fetchJSON(api('/api/admin/users'));
      users = Array.isArray(data) ? data : (data.users || data.results || []);
    } catch (e) {
      users = dbLoad().users;
    }
    usersIndex.clear();

    // build rows (8 cells: Users | Name | Roles | Departments | Groups | Nickname | Permissions | Actions)
    const rows = users.map(u => {
      usersIndex.set(u.id, u);
      const { groups, depts, perms } = expandForView(u);
      const permCount  = perms.length;
      const deptCount  = depts.length;
      const groupCount = groups.length;

      const avatar = (u.avatar_url || u.avatar) ? `
      <img alt="avatar" src="${escapeHtml(u.avatar_url || u.avatar)}"
         style="width:100%;height:100%;object-fit:cover;display:block" />
      ` : escapeHtml(initials(u.name || u.email));

      return `
      <tr data-id="${escapeHtml(u.id)}">
        <!-- Users (avatar only) -->
        <td>
        <div
          style="
          width:36px;height:36px;border-radius:50%;overflow:hidden;
          background:#e5e7eb;display:flex;align-items:center;justify-content:center;
          font-weight:700;font-size:12px;color:#374151;">
          ${avatar}
        </div>
        </td>

        <!-- Name (name + email) -->
        <td>
        <div style="font-weight:600;line-height:1.2;text-align:left">${escapeHtml(u.name || '')}</div>
        <div class="muted" style="font-size:0.85em;line-height:1.2;text-align:left">${escapeHtml(u.email || '')}</div>
        </td>

        <!-- Roles (plain text, map Original → Owner) -->
        <td><span class="pill" style="text-align:left">${escapeHtml(roleDisplay(u))}</span></td>

        <!-- Departments (count + caret) -->
        <td class="num" style="text-align:left">
        <button class="btn sm count-btn" data-list="depts" data-id="${escapeHtml(u.id)}" title="View departments">
          <span class="pill">${deptCount}</span> <i class="bi bi-chevron-down" aria-hidden="true"></i>
        </button>
        </td>

        <!-- Groups (count + caret) -->
        <td class="num" style="text-align:left">
        <button class="btn sm count-btn" data-list="groups" data-id="${escapeHtml(u.id)}" title="View groups">
          <span class="pill">${groupCount}</span> <i class="bi bi-chevron-down" aria-hidden="true"></i>
        </button>
        </td>

        <!-- Nickname (raw; no fallback) -->
        <td style="text-align:left">${escapeHtml(u.nickname ?? '—')}</td>

        <!-- Permissions (count + caret) -->
        <td class="num" style="text-align:left">
        <button class="btn sm count-btn" data-list="perms" data-id="${escapeHtml(u.id)}" title="View permissions">
          <span class="pill">${permCount}</span> <i class="bi bi-chevron-down" aria-hidden="true"></i>
        </button>
        </td>

        <!-- Actions -->
        <td class="actions" style="text-align:left">
        <button class="btn sm" data-act="edit" data-id="${escapeHtml(u.id)}">Edit</button>
        <button class="btn sm danger" data-act="delete" data-id="${escapeHtml(u.id)}">Delete</button>
        </td>
      </tr>
      `;
    }).join('');


    tbody.innerHTML = rows;

    const summary = $('usersSummary');
    if (summary) {
      summary.textContent = `${users.length} user${users.length !== 1 ? 's' : ''} total`;
    }
  }

  // -------------------- CRUD --------------------
  function resetForm() {
    const frm = $('userForm');
    if (frm) frm.dataset.editing = '';
    const name = $('ufName'); if (name) name.value = '';
    const email = $('ufEmail'); if (email) email.value = '';
    const pwd = $('ufPassword'); if (pwd) pwd.value = '';
    const role = $('ufRole'); if (role) role.value = 'Member';
    permsMS && permsMS.setSelected([]);
    groupsMS && groupsMS.setSelected([]);
    deptsMS && deptsMS.setSelected([]);
  }

  function randomPassword(len=12) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*?';
    let out = '';
    for (let i=0;i<len;i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  async function createOrUpdateUser() {
    const nameEl = $('ufName');
    const emailEl = $('ufEmail');
    const pwdEl = $('ufPassword');
    const roleEl = $('ufRole');
    const name = (nameEl?.value || '').trim();
    const email = (emailEl?.value || '').trim().toLowerCase();
    const password = pwdEl?.value || '';
    const role = roleEl?.value || 'Member';

    if (!name) { toast('Name is required'); return; }
    if (!email) { toast('Email is required'); return; }

    let perm_ids = permsMS?.getSelected() || [];
    let group_ids = groupsMS?.getSelected() || [];
    let dept_ids = deptsMS?.getSelected() || [];

    // Admin gets everything automatically
    if (role.toLowerCase() === 'admin') {
      perm_ids = allPerms().map(p => p.key || p.id);
      group_ids = allGroups().map(g => g.id);
      dept_ids = allDepts().map(d => d.id);
    }

    const frm = $('userForm');
    const editingId = (frm?.dataset?.editing || '').trim();

    const payload = { id: editingId || undefined, name, email, role, perm_ids, group_ids, dept_ids };
    if (password) payload.password = password;

    let ok = true;
    try {
      await fetchJSON(api('/api/admin/users'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      ok = false;
    }

    if (!ok) {
      // local fallback
      const db = dbLoad();
      if (editingId) {
        const i = db.users.findIndex(x => x.id === editingId);
        if (i >= 0) db.users[i] = { ...db.users[i], ...payload };
      } else {
        db.users.push({ id: uid(), ...payload });
      }
      dbSave(db);
    }

    toast(editingId ? 'User updated' : 'User created');
    $('addUserModal')?.close();
    resetForm();
    await loadUsers();
  }

  async function deleteUser(id) {
    if (!id) return;
    const u = usersIndex.get(id);
    if (!u) { toast('User not found'); return; }

    // forbid deleting the last Admin
    const users = Array.from(usersIndex.values());
    const adminCount = users.filter(x => (x.role || '').toLowerCase() === 'admin' && x.id !== id).length;
    if ((u.role || '').toLowerCase() === 'admin' && adminCount < 1) {
      toast('Cannot delete the only Admin', 'warn');
      return;
    }

    let ok = true;
    try {
      await fetchJSON(api('/api/admin/users'), {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      const db = dbLoad();
      db.users = db.users.filter(x => x.id !== id);
      dbSave(db);
    }

    toast('User deleted');
    await loadUsers();
  }

  async function openEditUser(u) {
    await Promise.all([loadGroups(), loadPermissions(), loadDepartments()]);
    const dlg = $('addUserModal');
    const frm = $('userForm');
    if (frm) frm.dataset.editing = u.id;
    $('ufName').value = u.name || '';
    $('ufEmail').value = u.email || '';
    $('ufRole').value = u.role || 'Member';
    // Password left blank intentionally

    const { groups, depts, perms } = expandForView(u);
    groupsMS && groupsMS.setSelected(groups);
    deptsMS && deptsMS.setSelected(depts);
    permsMS && permsMS.setSelected(perms);

    dlg?.showModal?.();
    setTimeout(() => $('ufName')?.focus(), 0);
  }

  // -------------------- modal: list viewer --------------------
  function showListModal(title, items) {
    const dlg = $('listModal');
    if (!dlg) { alert(items.join('\n')); return; }
    $('listModalTitle').textContent = title;
    const ul = $('listModalList');
    ul.innerHTML = items.length ? items.map(x => `<li>${escapeHtml(x)}</li>`).join('') : '<li class="muted">None</li>';
    dlg.showModal?.();
  }

  // -------------------- wire up --------------------
  function bindHandlers() {
    // open Add User
    const addBtn = $('btnAddUser');
    if (addBtn) addBtn.addEventListener('click', async () => {
      resetForm();
      await Promise.all([loadGroups(), loadPermissions(), loadDepartments()]);
      $('addUserModal')?.showModal?.();
      setTimeout(() => $('ufName')?.focus(), 0);
    });

    // cancel
    $('btnCancelUser')?.addEventListener('click', () => $('addUserModal')?.close());

    // generate password
    $('btnGenPass')?.addEventListener('click', () => {
      const el = $('ufPassword');
      if (el) el.value = randomPassword();
    });

    // save
    $('createBtn')?.addEventListener('click', (e) => {
      e?.preventDefault?.();
      createOrUpdateUser();
    });

    // list modal close
    $('closeListModal')?.addEventListener('click', () => $('listModal')?.close());

    // table delegation
    const tbody = qq('#usersTable tbody');
    if (tbody) tbody.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.act === 'edit') {
        const u = usersIndex.get(id);
        if (!u) { toast('User not found'); return; }
        await openEditUser(u);
        return;
      }
      if (btn.dataset.act === 'delete') {
        if (!confirm('Delete this user?')) return;
        await deleteUser(id);
        return;
      }
      if (btn.dataset.list) {
        const u = usersIndex.get(id);
        if (!u) { toast('User not found'); return; }
        const { groups, depts, perms } = expandForView(u);
        if (btn.dataset.list === 'perms') {
          showListModal(`${u.name} — Permissions`, (perms || []).map(findPermName));
        } else if (btn.dataset.list === 'groups') {
          showListModal(`${u.name} — Groups`, (groups || []).map(findGroupName));
        } else if (btn.dataset.list === 'depts') {
          showListModal(`${u.name} — Departments`, (depts || []).map(findDeptName));
        }
      }
    });

    // when org structure changes elsewhere, reload counts and admin rows reflect new items
    window.addEventListener('org-structure-updated', async () => {
      await Promise.all([loadGroups(), loadPermissions(), loadDepartments()]);
      await loadUsers();
    });
  }

  // -------------------- init --------------------
  (async function init() {
    try {
      await Promise.all([loadGroups(), loadPermissions(), loadDepartments()]);
      await loadUsers();
      bindHandlers();
    } catch (e) {
      console.error('[admin-users] init failed:', e);
      toast('Failed to load admin users');
    }
  })();

})();
