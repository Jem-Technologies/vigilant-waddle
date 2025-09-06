/* Admin Users JS — fully working client-side (no backend required)
   Replaces the original admin-users.js. Drop-in compatible with dashboard.html IDs.
   - Users table columns: Name (shows full name + email), Roles, Permissions, Departments, Groups, Actions
   - Actions: Edit, Delete
   - Edit User opens modal with Name, Email, Role, Groups, Permissions, Departments
   - Multi‑selects show counts and lists; Admin role auto-sees ALL groups/permissions/departments
*/

(() => {
  'use strict';

  // ---------- config ----------
  const API = ''; // same origin. If different origin, set e.g. 'https://api.yoursite.com';
  const api = (p) => API + p;

  // ---------- small helpers ----------
  const $  = (id) => document.getElementById(id);
  const qq = (sel, root=document) => root.querySelector(sel);
  function firstId(...ids){ for (const id of ids){ const el=$(id); if (el) return el; } return null; }
  function escapeHtml(s){
    return (s ?? '').toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  const uid = () => (crypto?.randomUUID?.() || ('id_'+Math.random().toString(36).slice(2)));

  // ---------- safe fetch helper with JSON + graceful failure ----------
  async function fetchJSON(url, opts = {}) {
    const res = await fetch(url, { credentials: 'include', ...opts }).catch(()=> null);
    if (!res) throw new Error('Network');
    const ct = res.headers.get('content-type') || '';
    let data = null, text = '';
    try {
      if (ct.includes('application/json')) data = await res.json();
      else { text = await res.text(); try{ data = JSON.parse(text); }catch{} }
    } catch {}
    if (!res.ok) {
      const msg = (data && (data.error || data.detail || data.message)) || (text?.slice(0,200)) || `HTTP ${res.status}`;
      throw new Error(`${url}: ${msg}`);
    }
    return data ?? {};
  }

  // ---------- toast ----------
  function toast(msg, tone=''){
    const el = $('toast'); if (!el) { console.log('[toast]', msg); return; }
    el.textContent = msg;
    el.className = `toast ${tone}`.trim();
    el.style.display = 'block';
    setTimeout(()=> el.style.display = 'none', 2200);
  }

  /* ========================================================================== */
  /* Local DB fallback (no backend required)                                    */
  /* ========================================================================== */
  const LS_KEY = 'admin_users_db_v1';
  function dbLoad(){
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || { users:[], groups:[], departments:[], permissions:[] }; }
    catch { return { users:[], groups:[], departments:[], permissions:[] }; }
  }
  function dbSave(db){ try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch {} }
  function dbEnsureSeeds(){
    const db = dbLoad();
    // only seed once if totally empty
    if (!db.permissions.length) {
      db.permissions = [
        { id:'users.read',  key:'users.read',  name:'Users: Read',  description:'Can read users' },
        { id:'users.write', key:'users.write', name:'Users: Write', description:'Can create/edit users' },
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
        { id: uid(), name:'Admin User', email:'admin@example.com', role:'Admin',
          group_ids: [], dept_ids: [], perm_ids: [] }
      ];
    }
    dbSave(db);
  }
  dbEnsureSeeds();

  // helpers
  function allGroups(){ return _groupsCache ?? ( _groupsCache = curGroups() ); }
  function allDepts(){ return _deptsCache ?? ( _deptsCache = curDepts() ); }
  function allPerms(){ return _permsCache ?? ( _permsCache = curPerms() ); }
  function curGroups(){ return Array.from(_groupsSrc || []); }
  function curDepts(){ return Array.from(_deptsSrc || []); }
  function curPerms(){ return Array.from(_permsSrc || []); }

  let _groupsSrc = null, _deptsSrc = null, _permsSrc = null;
  let _groupsCache = null, _deptsCache = null, _permsCache = null;

  function invalidateCaches(){ _groupsCache=_deptsCache=_permsCache=null; }

  /* ========================================================================== */
  /* Multi-select (keep original implementation for compatibility)              */
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
      row.className = 'row';
      row.innerHTML = `
        <label for="${cid}">
          <input type="checkbox" id="${cid}" value="${escapeHtml(id)}" />
          <span class="label">
            <strong>${escapeHtml(it.label || it.name || it.key || id)}</strong>
            ${it.sublabel ? `<small>${escapeHtml(it.sublabel)}</small>` : ''}
          </span>
        </label>
      `;
      menu.appendChild(row);
    }

    // toggling for non-<details> flavor
    let open = false;
    if (!isDetails) {
      rootEl.setAttribute('aria-expanded', 'false');
      menu.hidden = true;

      const openMenu  = () => { if (open) return; open = true;  rootEl.setAttribute('aria-expanded','true');  menu.hidden = false;  trigger?.setAttribute('aria-expanded','true');  menu.querySelector('input')?.focus({ preventScroll:true }); };
      const closeMenu = () => { if (!open) return; open = false; rootEl.setAttribute('aria-expanded','false'); menu.hidden = true;   trigger?.setAttribute('aria-expanded','false'); };

      trigger?.addEventListener('click', (e)=>{ e.preventDefault(); (open ? closeMenu : openMenu)(); });
      document.addEventListener('pointerdown', (e)=>{
        if (!open) return;
        if (rootEl.contains(e.target)) return;
        closeMenu();
      }, true);
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

  /* ========================================================================== */
  /* Loaders with backend+fallback                                              */
  /* ========================================================================== */
  let groupsMS, permsMS, deptsMS;
  async function loadGroups(){
    let list = [];
    try {
      const data = await fetchJSON(api('/api/groups'));
      list = Array.isArray(data) ? data : (data.groups || data.results || []);
    } catch { list = dbLoad().groups; }
    _groupsSrc = list.map(g => ({ id:g.id, name:g.name, department_id:g.department_id, department_name: g.department_name || (dbLoad().departments.find(d=>d.id===g.department_id)?.name || '') }));
    invalidateCaches();
    const items = _groupsSrc.map(g => ({
      id: g.id, label: g.name, sublabel: g.department_name ? `Dept: ${g.department_name}` : ''
    }));
    const root = $('ufGroupsMS');
    if (root) groupsMS = buildMultiSelect(root, items);
  }
  async function loadPermissions(){
    let list = [];
    try {
      const data = await fetchJSON(api('/api/permissions'));
      list = Array.isArray(data) ? data : (data.permissions || data.results || []);
    } catch { list = dbLoad().permissions; }
    _permsSrc = list.map(p => ({ id: (p.id || p.key), key: (p.key || p.id), name: (p.name || p.key || p.id), description: p.description || '' }));
    invalidateCaches();
    const items = _permsSrc.map(p => ({ id: p.id, label: p.key || p.name || p.id, sublabel: p.description || '' }));
    const root = $('ufPermsMS');
    if (root) permsMS = buildMultiSelect(root, items);
  }
  async function loadDepartments(){
    let list = [];
    try {
      const data = await fetchJSON(api('/api/departments'));
      list = Array.isArray(data) ? data : (data.departments || data.results || []);
    } catch { list = dbLoad().departments; }
    _deptsSrc = list.map(d => ({ id:d.id, name:d.name }));
    invalidateCaches();
    const items = _deptsSrc.map(d => ({ id: d.id, label: d.name }));
    const root = $('ufDeptsMS');
    if (root) deptsMS = buildMultiSelect(root, items);
  }

  /* ========================================================================== */
  /* Users table                                                                */
  /* ========================================================================== */
  let usersIndex = new Map();

  // Utility to expand Admin's "ALL" virtual membership
  function expandForView(u){
    const groups = (u.role === 'Admin') ? allGroups().map(g=>g.id) : (u.group_ids || tryParse(u.group_ids_json) || []);
    const depts  = (u.role === 'Admin') ? allDepts().map(d=>d.id)  : (u.dept_ids  || tryParse(u.dept_ids_json)  || []);
    const perms  = (u.role === 'Admin') ? allPerms().map(p=>p.key) : (u.perm_keys || tryParse(u.perms_json)     || []);
    return { groups, depts, perms };
  }
  function tryParse(s){ try { return JSON.parse(s || '[]'); } catch { return []; } }

  async function loadUsers(){
    const tbody = qq('#usersTable tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    // get users
    let users = [];
    try {
      const data = await fetchJSON(api('/api/admin/users'));
      users = Array.isArray(data) ? data : (data.users || data.results || []);
    } catch {
      users = dbLoad().users;
    }

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

      const { groups, depts, perms } = expandForView(u);

      const tr = document.createElement('tr');
      tr.dataset.id = u.id;

      tr.innerHTML = `
        <td>
          <div style="font-weight:600">${escapeHtml(u.name || '')}</div>
          <div class="muted" style="font-size:.85em">${escapeHtml(u.email || '')}</div>
        </td>
        <td><span class="pill">${escapeHtml(u.role || 'Member')}</span></td>

        <td class="num">
          <button class="btn sm count-btn" title="View permissions" data-list="perms" data-id="${u.id}">
            <span class="pill">${perms.length}</span> <i class="bi bi-chevron-down" aria-hidden="true"></i>
          </button>
        </td>

        <td class="num">
          <button class="btn sm count-btn" title="View departments" data-list="depts" data-id="${u.id}">
            <span class="pill">${depts.length}</span> <i class="bi bi-chevron-down" aria-hidden="true"></i>
          </button>
        </td>

        <td class="num">
          <button class="btn sm count-btn" title="View groups" data-list="groups" data-id="${u.id}">
            <span class="pill">${groups.length}</span> <i class="bi bi-chevron-down" aria-hidden="true"></i>
          </button>
        </td>

        <td class="actions">
          <button class="btn sm" data-act="edit"   data-id="${u.id}">Edit</button>
          <button class="btn sm danger" data-act="delete" data-id="${u.id}">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    const summary = $('usersSummary');
    if (summary) summary.textContent = `${users.length} user${users.length!==1?'s':''} total`;
  }

  /* ========================================================================== */
  /* Create / Update / Delete user                                              */
  /* ========================================================================== */
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
    deptsMS?.setSelected([]);
  }

  async function createUser(){
    const nameEl     = firstId('ufName','name');
    const emailEl    = firstId('ufEmail','email');
    const passwordEl = firstId('ufPassword','password');
    const roleEl     = firstId('ufRole','role');

    const name     = nameEl?.value.trim();
    const email    = emailEl?.value.trim().toLowerCase();
    const password = passwordEl?.value || '';
    const role     = roleEl?.value || 'Member';

    if (!name)  return toast('Name is required');
    if (!email) return toast('Email is required');

    // collect selections
    let perm_ids = permsMS?.getSelected() || [];
    let group_ids = groupsMS?.getSelected() || [];
    let dept_ids = deptsMS?.getSelected() || [];

    // Admin gets everything automatically
    if (role === 'Admin') {
      perm_ids = allPerms().map(p=>p.id || p.key);
      group_ids = allGroups().map(g=>g.id);
      dept_ids = allDepts().map(d=>d.id);
    }

    const payload = {
      name, email, role,
      perm_ids, group_ids, dept_ids
    };

    const formEl = $('userForm');
    const editingId = formEl?.dataset?.editing || '';
    if (editingId) payload.id = editingId;
    if (password) payload.password = password;

    // Try server first
    let ok = true;
    try {
      await fetchJSON(api('/api/admin/users'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch {
      ok = false;
    }

    // Fallback: local DB update
    if (!ok) {
      const db = dbLoad();
      if (editingId) {
        const i = db.users.findIndex(x => x.id === editingId);
        if (i>=0) db.users[i] = { ...db.users[i], ...payload };
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

  async function deleteUser(id){
    if (!id) return;
    const u = usersIndex.get(id);
    if (!u) return toast('User not found');
    if (u.role === 'Admin') {
      // count how many admins remain
      let users = [];
      try {
        const data = await fetchJSON(api('/api/admin/users'));
        users = Array.isArray(data) ? data : (data.users || data.results || []);
      } catch {
        users = dbLoad().users;
      }
      const otherAdmins = users.filter(x => x.role === 'Admin' && x.id !== id).length;
      if (otherAdmins < 1) return toast('Cannot delete the only Admin', 'warn');
    }

    // Try server
    let ok = true;
    try {
      await fetchJSON(api('/api/admin/users'), {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });
    } catch { ok = false; }

    if (!ok) {
      const db = dbLoad();
      db.users = db.users.filter(x => x.id !== id);
      dbSave(db);
    }

    toast('User deleted');
    await loadUsers();
  }

  /* ========================================================================== */
  /* Edit User modal                                                            */
  /* ========================================================================== */
  async function openEditUser(u) {
    await Promise.all([loadGroups(), loadPermissions(), loadDepartments()]);

    const dlg = $('addUserModal');
    dlg?.showModal?.();

    const formEl = $('userForm');
    if (formEl) formEl.dataset.editing = u.id;

    $('ufName').value  = u.name  || '';
    $('ufEmail').value = u.email || '';
    $('ufRole').value  = u.role  || 'Member';

    const { groups, depts, perms } = expandForView(u);

    permsMS?.setSelected(perms);
    groupsMS?.setSelected(groups);
    deptsMS?.setSelected(depts);

    setTimeout(()=> $('ufName')?.focus(), 0);
  }

  /* ========================================================================== */
  /* Dialogs: Add User & List modal                                             */
  /* ========================================================================== */
  const addUserDlg = $('addUserModal');

  // open/close
  firstId('btnAddUser','addUserBtn')?.addEventListener('click', async ()=>{
    resetForm();
    await Promise.all([loadGroups(), loadPermissions(), loadDepartments()]);
    addUserDlg?.showModal?.();
    setTimeout(()=> $('ufName')?.focus(), 0);
  });
  firstId('btnCancelUser','closeUserBtn')?.addEventListener('click', ()=>{
    addUserDlg?.close?.();
  });

  // Generate password
  firstId('genPwdBtn','btnGenPass')?.addEventListener('click', ()=>{
    const el = firstId('password','ufPassword');
    if (!el) return;
    el.value = randomPassword();
  });

  // click-outside-to-close
  addUserDlg?.addEventListener('click', (e) => {
    const card = addUserDlg.querySelector('.modal-dialog');
    if (!card) return;
    const r = card.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) addUserDlg.close();
  });

  // Save
  $('createBtn')?.addEventListener('click', createUser);

  // small generator
  function randomPassword(len=12){
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*?';
    let out = '';
    for (let i=0;i<len;i++) out += chars[Math.floor(Math.random()*chars.length)];
    return out;
  }

  // List modal (for viewing permissions/groups/departments)
  function showListModal(title, items){
    const dlg = $('listModal');
    if (!dlg) return alert(items.join('\n'));
    $('listModalTitle').textContent = title;
    const ul = $('listModalList');
    ul.innerHTML = items.length ? items.map(x=>`<li>${escapeHtml(x)}</li>`).join('') : '<li class="muted">None</li>';
    dlg.showModal?.();
  }
  $('closeListModal')?.addEventListener('click', ()=> $('listModal')?.close());

  // Table interactions
  qq('#usersTable tbody')?.addEventListener('click', async (e)=>{
    const btn = e.target.closest('button[data-act], button[data-list]');
    if (!btn) return;

    const id  = btn.dataset.id;
    if (btn.dataset.act === 'edit') {
      const u = usersIndex.get(id);
      if (!u) return toast('User not found');
      await openEditUser(u);
      return;
    }
    if (btn.dataset.act === 'delete') {
      if (!confirm('Delete this user?')) return;
      await deleteUser(id);
      return;
    }

    // List buttons
    const list = btn.dataset.list;
    if (list) {
      const u = usersIndex.get(id);
      if (!u) return toast('User not found');
      const { groups, depts, perms } = expandForView(u);
      if (list === 'perms' || list === 'permissions') {
        const labels = (perms || []).map(k => (allPerms().find(p=>p.key === k || p.id === k)?.name || k));
        showListModal(`${u.name} — Permissions`, labels);
      } else if (list === 'groups') {
        const labels = (groups || []).map(gid => (allGroups().find(g=>g.id===gid)?.name || gid));
        showListModal(`${u.name} — Groups`, labels);
      } else if (list === 'depts' || list === 'departments') {
        const labels = (depts || []).map(did => (allDepts().find(d=>d.id===did)?.name || did));
        showListModal(`${u.name} — Departments`, labels);
      }
      return;
    }
  });

  // ---------- boot ----------
  (async function init(){
    try {
      await Promise.all([loadGroups(), loadPermissions(), loadDepartments()]);
      await loadUsers();
    } catch (e) {
      console.error(e);
      toast('Failed to load admin data');
    }
  })();

})();
