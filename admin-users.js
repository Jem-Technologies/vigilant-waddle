// admin-users.js — renders Admin → Users table in the exact requested format
(function () {
  const API_USERS = '/api/users'; // this matches functions/api/users.js

  const $$ = (sel, root = document) => root.querySelector(sel);
  const $$$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => (s == null ? '' : String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;')
  );
  const parseJSON = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    try { return JSON.parse(v); } catch { return []; }
  };

  // inject minimal styles for caret dropdowns
  function injectStyles() {
    if ($$('#admin-users-styles')) return;
    const css = `
      #usersTable .num { text-align: center; }
      .pill-role {
        display:inline-block; padding:4px 8px; border-radius:999px;
        background:#eef2ff; color:#3730a3; font-weight:600; font-size:12px;
      }
      .avatar {
        width:36px; height:36px; border-radius:50%; overflow:hidden;
        background:#e5e7eb; display:flex; align-items:center; justify-content:center;
        font-weight:700; font-size:12px; color:#374151;
      }
      .avatar img { width:100%; height:100%; object-fit:cover; display:block; }
      .name-block .primary { font-weight:600; line-height:1.2; }
      .name-block .muted { color:#6b7280; font-size:12px; line-height:1.2; }
      .caret-btn {
        display:inline-flex; align-items:center; gap:6px; padding:6px 10px;
        border:1px solid #e5e7eb; border-radius:8px; background:#fff; cursor:pointer;
        font:inherit;
      }
      .caret-btn[aria-disabled="true"] { opacity:.5; cursor:default; }
      .caret-btn .count { font-weight:700; }
      .caret-btn .caret { font-size:11px; }
      .dropdown {
        position:absolute; z-index:30; min-width:220px; max-width:360px;
        background:#fff; border:1px solid #e5e7eb; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,.08);
        padding:8px; margin-top:6px;
      }
      .dropdown ul { list-style:none; margin:0; padding:0; max-height:260px; overflow:auto; }
      .dropdown li { padding:6px 8px; border-radius:6px; }
      .dropdown li+li { margin-top:2px; }
      .dropdown li:hover { background:#f3f4f6; }
      .cell-actions .btn {
        display:inline-flex; align-items:center; gap:6px;
        padding:6px 10px; border-radius:8px; border:1px solid #e5e7eb; background:#fff; cursor:pointer;
      }
      .cell-actions .btn + .btn { margin-left:8px; }
      .cell-actions .btn.danger { border-color:#fecaca; background:#fff1f2; color:#991b1b; }
      .td-wrap { position:relative; } /* anchor for dropdown */
    `;
    const style = document.createElement('style');
    style.id = 'admin-users-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  async function fetchUsers() {
    const res = await fetch(API_USERS, { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load users');
    return res.json();
  }

  function initials(nameOrEmail) {
    const s = (nameOrEmail || '').trim();
    if (!s) return '?';
    const parts = s.split(/\s+/);
    if (parts.length === 1 && s.includes('@')) {
      return s[0].toUpperCase();
    }
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }

  function roleDisplay(row) {
    const r = (row?.role || '').trim();
    if (row?.is_owner) return 'Owner';
    if (r.toLowerCase() === 'original') return 'Owner'; // map "Original" → "Owner"
    return r || 'Member';
  }

  function makeCaretCell(items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'caret-btn';
    const list = Array.isArray(items) ? items : [];
    const count = list.length;
    btn.innerHTML = `<span class="count">${count}</span><span class="caret">▾</span>`;
    btn.setAttribute('aria-expanded', 'false');
    if (count === 0) btn.setAttribute('aria-disabled', 'true');
    btn.dataset.items = JSON.stringify(list);
    return btn;
  }

  function closeAllDropdowns(root) {
    $$$('.dropdown', root).forEach(d => d.remove());
    $$$('.caret-btn[aria-expanded="true"]', root).forEach(b => b.setAttribute('aria-expanded', 'false'));
  }

  function openDropdown(anchorBtn) {
    const rootCell = anchorBtn.closest('.td-wrap');
    if (!rootCell) return;
    const alreadyOpen = anchorBtn.getAttribute('aria-expanded') === 'true';
    closeAllDropdowns(rootCell.closest('tbody') || document);
    if (alreadyOpen) return;

    const items = parseJSON(anchorBtn.dataset.items) || [];
    const dd = document.createElement('div');
    dd.className = 'dropdown';
    dd.innerHTML = `<ul>${items.map(x => `<li>${esc(x)}</li>`).join('') || `<li class="muted">No items</li>`}</ul>`;
    anchorBtn.setAttribute('aria-expanded', 'true');
    rootCell.appendChild(dd);
  }

  function buildRow(row) {
    const tr = document.createElement('tr');

    // --- Users (avatar) ---
    const tdUsers = document.createElement('td');
    tdUsers.className = 'td-wrap';
    const av = document.createElement('div');
    av.className = 'avatar';
    if (row.avatar_url) {
      const img = document.createElement('img');
      img.alt = 'avatar';
      img.src = row.avatar_url;
      av.appendChild(img);
    } else {
      av.textContent = initials(row.name || row.email);
    }
    tdUsers.appendChild(av);
    tr.appendChild(tdUsers);

    // --- Name (name + email) ---
    const tdName = document.createElement('td');
    tdName.innerHTML = `
      <div class="name-block">
        <div class="primary">${esc(row.name)}</div>
        <div class="muted">${esc(row.email)}</div>
      </div>`;
    tr.appendChild(tdName);

    // --- Roles (plain pill) ---
    const tdRole = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = 'pill-role';
    pill.textContent = roleDisplay(row);
    tdRole.appendChild(pill);
    tr.appendChild(tdRole);

    // --- Departments (count + caret dropdown) ---
    const tdDeps = document.createElement('td');
    tdDeps.className = 'td-wrap';
    const depNames = parseJSON(row.dept_names_json);
    tdDeps.appendChild(makeCaretCell(depNames));
    tr.appendChild(tdDeps);

    // --- Groups (count + caret dropdown) ---
    const tdGrps = document.createElement('td');
    tdGrps.className = 'td-wrap';
    const grpNames = parseJSON(row.group_names_json);
    tdGrps.appendChild(makeCaretCell(grpNames));
    tr.appendChild(tdGrps);

    // --- Nickname (raw nickname) ---
    const tdNick = document.createElement('td');
    tdNick.textContent = row.nickname ? String(row.nickname) : '—';
    tr.appendChild(tdNick);

    // --- Permissions (count + caret dropdown) ---
    const tdPerms = document.createElement('td');
    tdPerms.className = 'td-wrap';
    const permKeys = parseJSON(row.perms_json);
    tdPerms.appendChild(makeCaretCell(permKeys));
    tr.appendChild(tdPerms);

    // --- Actions (Edit/Delete) ---
    const tdAct = document.createElement('td');
    tdAct.className = 'cell-actions';
    tdAct.innerHTML = `
      <button type="button" class="btn js-edit" data-id="${esc(row.id)}">Edit</button>
      <button type="button" class="btn danger js-del" data-id="${esc(row.id)}">Delete</button>
    `;
    tr.appendChild(tdAct);

    return tr;
  }

  function wireTableInteractions(tbody) {
    // Caret dropdowns (delegated)
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('.caret-btn');
      if (btn) {
        if (btn.getAttribute('aria-disabled') === 'true') return;
        openDropdown(btn);
        e.stopPropagation();
        return;
      }
      const dropdown = e.target.closest('.dropdown');
      if (dropdown) return; // clicks inside dropdown don’t bubble-close
      closeAllDropdowns(tbody);
    });

    // Clicking outside -> close dropdowns
    document.addEventListener('click', (evt) => {
      if (!tbody.contains(evt.target)) closeAllDropdowns(tbody);
    });

    // Actions
    tbody.addEventListener('click', (e) => {
      const edit = e.target.closest('.js-edit');
      if (edit) {
        const id = edit.dataset.id;
        if (window.openEditUser) return void window.openEditUser(id);
        // Fallback (non-invasive): emit a custom event for existing code to hook
        tbody.dispatchEvent(new CustomEvent('admin.users.edit', { detail: { id }, bubbles: true }));
        return;
      }
      const del = e.target.closest('.js-del');
      if (del) {
        const id = del.dataset.id;
        if (window.deleteUser) return void window.deleteUser(id);
        tbody.dispatchEvent(new CustomEvent('admin.users.delete', { detail: { id }, bubbles: true }));
      }
    });
  }

  async function render() {
    injectStyles();
    const table = $$('#usersTable');
    if (!table) return console.error('[admin-users] #usersTable not found');
    const tbody = table.tBodies[0] || table.createTBody();
    tbody.innerHTML = '<tr><td colspan="8">Loading…</td></tr>';

    let users = [];
    try {
      users = await fetchUsers();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8">Failed to load users.</td></tr>`;
      console.error(err);
      return;
    }

    tbody.innerHTML = '';
    if (!Array.isArray(users) || users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8">No users yet.</td></tr>`;
      return;
    }

    for (const u of users) tbody.appendChild(buildRow(u));
    wireTableInteractions(tbody);
  }

  // Auto-run on ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
