/* Admin Users JS */
/* global fetch, document, CustomEvent, crypto */

// ---- config ----
  const API = ''; // same origin. If different origin, set e.g. 'https://api.yoursite.com'
  function api(path){ return API + path; }

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

  /* ---------- tiny toast ---------- */
  const toastEl = document.getElementById('toast');
  function toast(msg){ toastEl.textContent = msg; toastEl.classList.add('show'); setTimeout(()=>toastEl.classList.remove('show'), 2200); }

  /* ---------- multi-select factory ---------- */
  function buildMultiSelect(rootEl, items, { onChange } = {}) {
    const menu = rootEl.querySelector('.ms-menu');
    menu.innerHTML = '';
    const state = new Set();

    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'opt';
      row.setAttribute('role','option');
      row.dataset.id = it.id;
      row.innerHTML = `
        <input type="checkbox" aria-label="${it.label}">
        <div>
          <div>${it.label}</div>
          ${it.sublabel ? `<div class="muted">${it.sublabel}</div>` : ''}
        </div>
      `;
      row.addEventListener('click', (e) => {
        const cb = row.querySelector('input[type="checkbox"]');
        cb.checked = !cb.checked;
        if (cb.checked) state.add(it.id); else state.delete(it.id);
        onChange?.(state);
        updateCount();
      });
      menu.appendChild(row);
    }

    function updateCount(){
      const countEl = rootEl.querySelector('.count span');
      countEl.textContent = state.size;
    }

    rootEl.addEventListener('click', (e)=>{
      if (e.target.closest('button')) {
        const open = rootEl.getAttribute('aria-expanded') === 'true';
        rootEl.setAttribute('aria-expanded', open ? 'false' : 'true');
      }
    });
    document.addEventListener('click', (e)=>{
      if (!rootEl.contains(e.target)) rootEl.setAttribute('aria-expanded', 'false');
    });

    return {
      getSelected: () => Array.from(state),
      setSelected: (ids) => {
        state.clear();
        ids.forEach(id => state.add(id));
        for (const row of menu.querySelectorAll('.opt')) {
          const cb = row.querySelector('input[type="checkbox"]');
          cb.checked = state.has(row.dataset.id);
        }
        rootEl.querySelector('.count span').textContent = state.size;
      }
    };
  }

  /* ---------- populate dropdowns & table ---------- */
  let groupsMS, permsMS;
  async function loadGroups(){
    const { groups=[] } = await fetchJSON(api('/api/groups'));
    const items = groups.map(g => ({ id: g.id, label: g.name }));
    groupsMS = buildMultiSelect(document.getElementById('groupsMS'), items, { onChange: ()=>{} });
  }
  async function loadPermissions(){
    const { permissions=[] } = await fetchJSON(api('/api/permissions'));
    const items = permissions.map(p => ({ id: p.id, label: p.key, sublabel: p.description }));
    permsMS = buildMultiSelect(document.getElementById('permsMS'), items, { onChange: ()=>{} });
  }
  async function loadUsers(){
    const tbody = document.querySelector('#usersTable tbody');
    tbody.innerHTML = '';
    const users = await fetchJSON(api('/api/users'));
    if (!users.length) { document.getElementById('emptyState').style.display = 'block'; return; }
    document.getElementById('emptyState').style.display = 'none';
    for (const u of users) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(u.name || '')}</td>
        <td>${escapeHtml(u.email || '')}</td>
        <td><span class="pill">${escapeHtml(u.role || 'Member')}</span></td>
        <td><span class="pill" title="Groups">${Number(u.group_count||0)}</span></td>
        <td><span class="pill" title="Permissions">${Number(u.perm_count||0)}</span></td>
        <td>
          <button class="btn ghost" data-act="reset-pwd" data-id="${u.id}">Reset</button>
        </td>
        <td>
          <button class="btn ghost" data-act="edit" data-id="${u.id}">Edit</button>
          <button class="btn ghost" data-act="disable" data-id="${u.id}">Disable</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  function escapeHtml(s){ return (s ?? '').toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  /* ---------- create user ---------- */
  async function createUser(){
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim().toLowerCase();
    const password = document.getElementById('password').value;
    const role = document.getElementById('role').value;
    const group_ids = groupsMS?.getSelected() || [];
    const permission_ids = permsMS?.getSelected() || [];

    if (!email) { toast('Email is required'); return; }
    if (!name) { toast('Name is required'); return; }

    const payload = { name, display_name: name, email, role, group_ids, permission_ids };
    if (password) payload.password = password;

    await fetchJSON(api('/api/users'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    toast('User created');
    resetForm();
    await loadUsers();
  }

  function resetForm(){
    document.getElementById('name').value = '';
    document.getElementById('email').value = '';
    document.getElementById('password').value = '';
    document.getElementById('role').value = 'Member';
    groupsMS?.setSelected([]);
    permsMS?.setSelected([]);
  }

  /* ---------- create group / department & push to Chats ---------- */
  async function createGroup(){
    const name = document.getElementById('newGroupName').value.trim();
    if (!name) return toast('Group name required');
    const res = await fetchJSON(api('/api/groups'), {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ name })
    });
    document.getElementById('newGroupName').value = '';
    toast('Group created');
    await loadGroups(); // refresh dropdown
    // notify Chats panel to refresh channels
    window.dispatchEvent(new CustomEvent('org-structure-updated', { detail:{ type:'group', id: res?.group?.id, thread: res?.chat_thread_id }}));
  }

  async function createDepartment(){
    const name = document.getElementById('newDeptName').value.trim();
    if (!name) return toast('Department name required');
    const res = await fetchJSON(api('/api/departments'), {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ name })
    });
    document.getElementById('newDeptName').value = '';
    toast('Department created');
    // notify Chats panel to refresh channels
    window.dispatchEvent(new CustomEvent('org-structure-updated', { detail:{ type:'department', id: res?.department?.id, thread: res?.chat_thread_id }}));
  }

  /* ---------- password helpers ---------- */
  function randomPassword(len=12){
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*?';
    let out = '';
    for (let i=0;i<len;i++) out += chars[Math.floor(Math.random()*chars.length)];
    return out;
  }

  /* ---------- wire up ---------- */
  document.getElementById('createBtn').addEventListener('click', createUser);
  document.getElementById('resetFormBtn').addEventListener('click', resetForm);
  document.getElementById('createGroupBtn').addEventListener('click', createGroup);
  document.getElementById('createDeptBtn').addEventListener('click', createDepartment);

  document.getElementById('genPwdBtn').addEventListener('click', ()=>{
    document.getElementById('password').value = randomPassword();
  });
  document.getElementById('togglePwdBtn').addEventListener('click', ()=>{
    const f = document.getElementById('password');
    f.type = (f.type === 'password') ? 'text' : 'password';
  });

  // Table action handlers (stubs for now)
  document.querySelector('#usersTable tbody').addEventListener('click', async (e)=>{
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;

    if (act === 'reset-pwd') {
      const newPwd = prompt('Enter new password (leave empty to cancel):');
      if (!newPwd) return;
      // Re-use /api/users POST to set a password (id + password only)
      await fetchJSON(api('/api/users'), {
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

  // boot
  (async function init(){
    try {
      await Promise.all([loadGroups(), loadPermissions()]);
      await loadUsers();
    } catch (e) {
      console.error(e);
      toast('Failed to load admin data');
    }
  })();
