// dashboard.auth.js — drop-in
(async function boot() {
  try {
    // 1) Auth check
    const meRes = await fetch("/api/me", { method: "GET", credentials: "include" });
    const me = await meRes.json().catch(() => ({}));
    if (!meRes.ok || !me?.auth) {
      location.href = "/index.html#login";
      return;
    }
    window.currentUser = me.user;   // { id, name, username, email, role }
    window.currentOrg  = me.org;    // { id, slug, name }

    // 2) Render Users & Roles (enriched)
    await renderUsersExtended();

    // 3) Add Admin Chat & Conversations card (departments & groups)
    installChatConversationsAdminCard();

    // 4) Install nickname controls into Settings panel
    installNicknameSettings();

  } catch (e) {
    console.warn("dashboard.auth init failed:", e);
  }

  function safeArr(v) { return Array.isArray(v) ? v : []; }
function normPerm(p) {
  if (typeof p === 'string') return { key: p, name: p };
  if (p && typeof p === 'object') return { key: p.key || p.id || p.name || '', name: p.name || p.key || p.id || '' };
  return { key: '', name: '' };
}
function normGroup(g) {
  if (!g || typeof g !== 'object') return { id: '', name: '' };
  return { id: g.id ?? g.key ?? g.name ?? '', name: g.name ?? g.key ?? String(g.id ?? '') };
}
function normDept(d) {
  if (!d || typeof d !== 'object') return { id: '', name: '' };
  return { id: d.id ?? d.key ?? d.name ?? '', name: d.name ?? d.key ?? String(d.id ?? '') };
}

async function renderUsersExtended() {
  const table = document.getElementById('usersTable');
  const summary = document.getElementById('usersSummary');
  if (!table) return;

  // Make sure org lists are ready so Admin can expand to ALL
  if (!_groups?.length || !_depts?.length || !_perms?.length) {
    await Promise.all([loadGroups(), loadDepartments(), loadPermissions()]);
  }

  // Try details API first
  let raw = [];
  let usedDetails = true;
  try {
    const r = await fetch('/api/admin/users.details', { credentials: 'include' });
    const data = await r.json().catch(() => []);
    if (!r.ok) throw new Error('users.details failed');
    raw = Array.isArray(data) ? data : (data.users || data.results || []);
  } catch {
    usedDetails = false;
  }
  if (!usedDetails) {
    try {
      const r = await fetch('/api/admin/users', { credentials: 'include' });
      const data = await r.json().catch(() => []);
      raw = Array.isArray(data) ? data : (data.users || data.results || []);
    } catch {
      raw = dbLoad().users || [];
    }
  }}

  // Normalize per user; if anything is missing, skip that row instead of crashing everything
  const users = [];
  for (const u of safeArr(raw)) {
    try {
    const id = u?.id || u?._id || u?.uuid || u?.user_id || u?.userId;
    if (!id) continue; // skip malformed user

    const role = (u.role || u.user_role || 'Member');
    let departments = usedDetails
      ? safeArr(u.departments).map(normDept)
      : safeArr(u.dept_ids).map(did => ({
        id: did,
        name: (_depts.find(d => String(d.id) === String(did))?.name || String(did))
      }));
    let groups = usedDetails
      ? safeArr(u.groups).map(normGroup)
      : safeArr(u.group_ids).map(gid => ({
        id: gid,
        name: (_groups.find(g => String(g.id) === String(gid))?.name || String(gid))
      }));
    let permissions = usedDetails
      ? safeArr(u.permissions).map(normPerm)
      : safeArr(u.perm_ids || u.perm_keys || u.privileges).map(normPerm);

    // Admin = ALL current org items
    if ((role || '').toLowerCase() === 'admin') {
      departments = (_depts  || []).map(d => ({ id: d.id, name: d.name }));
      groups      = (_groups || []).map(g => ({ id: g.id, name: g.name }));
      permissions = (_perms  || []).map(p => ({ key: (p.key || p.id), name: (p.name || p.key || p.id) }));
    }

    users.push({
      id,
      name: u.display_name || u.name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || '(no name)',
      email: (u.email || u.username || '').toLowerCase(),
      role,
      departments,
      groups,
      permissions
    });
    } catch (err) {
    console.error('[users.render] row skipped:', err);
    }
  }

  // If somehow empty, (re)seed a local Admin so the table never blanks out
  if (!users.length) {
    const db = dbLoad();
    if (!db.users?.length) {
    db.users = [{
      id: uid(),
      name: 'Admin User',
      email: 'admin@example.com',
      role: 'Admin',
      group_ids: [],
      dept_ids: [],
      perm_ids: []
    }];
    dbSave(db);
    }
    // re-run once with the local seed
    try {
    const local = dbLoad().users || [];
    raw = local;
    return await renderUsersExtended(); // safe recursion
    } catch (e) {
    console.error('[users.render] fallback failed:', e);
    }
  }

  // Build rows (chevrons are plain text so no icon lib required)
  const chev = '<span class="chev" aria-hidden="true">▾</span>';
  const tbody = table.querySelector('tbody');
  const html = users.map(u => {
    const permCount  = u.permissions.length;
    const deptCount  = u.departments.length;
    const groupCount = u.groups.length;
    return `
    <tr data-id="${escapeHtml(u.id)}">
      <td>
      <div style="font-weight:600">${escapeHtml(u.name || '')}</div>
      <div class="muted" style="font-size:.85em">${escapeHtml(u.email || '')}</div>
      </td>
      <td><span class="pill">${escapeHtml(u.role || 'Member')}</span></td>

      <td class="num">
      <button class="btn sm count-btn" data-list="perms" data-id="${escapeHtml(u.id)}" title="View permissions">
        <span class="pill">${permCount}</span> ${chev}
      </button>
      </td>

      <td class="num">
      <button class="btn sm count-btn" data-list="depts" data-id="${escapeHtml(u.id)}" title="View departments">
        <span class="pill">${deptCount}</span> ${chev}
      </button>
      </td>

      <td class="num">
      <button class="btn sm count-btn" data-list="groups" data-id="${escapeHtml(u.id)}" title="View groups">
        <span class="pill">${groupCount}</span> ${chev}
      </button>
      </td>

      <td class="actions">
      <button class="btn sm" data-act="edit" data-id="${escapeHtml(u.id)}">Edit</button>
      <button class="btn sm danger" data-act="delete" data-id="${escapeHtml(u.id)}">Delete</button>
      </td>
    </tr>
    `;
  }).join('');

  tbody.innerHTML = html;
  if (summary) summary.textContent = `${users.length} user${users.length !== 1 ? 's' : ''} total`;


  // --- Admin Chat & Conversations Manager (departments + groups) ---
  function installChatConversationsAdminCard() {
    const anchor = document.getElementById("adminUsersCard");
    if (!anchor) return;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <header class="panel-header">
        <h2>Chat & Conversations</h2>
        <span class="muted">Create, view and remove Departments & Groups. Deleting is blocked while members or threads exist.</span>
      </header>

      <div class="grid-2">
        <section id="deptManager">
          <h3 class="panel-sub">Departments</h3>
          <div class="form-row">
            <label>New department
              <input type="text" id="newDeptName" placeholder="e.g., Sales">
            </label>
            <button class="btn" id="btnCreateDept">Add</button>
          </div>
          <div class="table-wrap">
            <table class="table compact" id="deptTable">
              <thead><tr><th>Name</th><th class="num">Groups</th><th class="num">Threads</th><th class="num">Members</th><th></th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </section>

        <section id="groupManager">
          <h3 class="panel-sub">Groups</h3>
          <div class="form-row">
            <label>New group
              <input type="text" id="newGroupName" placeholder="e.g., Q3 Campaign">
            </label>
            <label>Department
              <select id="newGroupDept"></select>
            </label>
            <button class="btn" id="btnCreateGroup">Add</button>
          </div>
          <div class="table-wrap">
            <table class="table compact" id="groupTable">
              <thead><tr><th>Name</th><th>Department</th><th class="num">Threads</th><th class="num">Members</th><th></th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </section>
      </div>
    `;
    anchor.insertAdjacentElement("afterend", card);

    // Elements
    const elDeptName = card.querySelector('#newDeptName');
    const elDeptBtn  = card.querySelector('#btnCreateDept');
    const elDeptTbl  = card.querySelector('#deptTable tbody');

    const elGrpName  = card.querySelector('#newGroupName');
    const elGrpDept  = card.querySelector('#newGroupDept');
    const elGrpBtn   = card.querySelector('#btnCreateGroup');
    const elGrpTbl   = card.querySelector('#groupTable tbody');

    // Helpers
    const escapeHtml = s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
    const toast = (msg,type='info')=>{
      let bar=document.querySelector('.toast-bar'); if(!bar){bar=document.createElement('div');bar.className='toast-bar';document.body.appendChild(bar);}
      const t=document.createElement('div'); t.className=`toast ${type}`; t.textContent=msg; bar.appendChild(t);
      setTimeout(()=>{t.classList.add('out'); setTimeout(()=>t.remove(),300)},1800);
    };

    // Loaders
    async function loadDepartments() {
      const r = await fetch('/api/departments', { credentials:'include' });
      const arrMaybe = await r.json().catch(()=>[]);
      const arr = Array.isArray(arrMaybe) ? arrMaybe : (arrMaybe?.departments ?? arrMaybe?.items ?? []);
      if (!Array.isArray(arr)) { console.warn('departments returned non-array:', arrMaybe); toast('Failed to load departments','error'); return; }
      // Fill select for groups form
      elGrpDept.innerHTML = `<option value="">Select…</option>` + arr.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
      // Fill table
      elDeptTbl.innerHTML = arr.map(d => `
        <tr data-id="${d.id}">
          <td>${escapeHtml(d.name)}</td>
          <td class="num">${d.group_count||0}</td>
          <td class="num">${d.thread_count||0}</td>
          <td class="num">${d.member_count||0}</td>
          <td class="actions"><button class="icon-btn danger" data-del-dept="${d.id}" title="Delete">🗑</button></td>
        </tr>
      `).join('');
    }

    async function loadGroups() {
      const r = await fetch('/api/groups', { credentials:'include' });
      const arrMaybe = await r.json().catch(()=>[]);
      const arr = Array.isArray(arrMaybe) ? arrMaybe : (arrMaybe?.groups ?? arrMaybe?.items ?? []);
      if (!Array.isArray(arr)) { console.warn('groups returned non-array:', arrMaybe); toast('Failed to load groups','error'); return; }
      elGrpTbl.innerHTML = arr.map(g => `
        <tr data-id="${g.id}">
          <td>${escapeHtml(g.name)}</td>
          <td>${escapeHtml(g.department_name || '—')}</td>
          <td class="num">${g.thread_count||0}</td>
          <td class="num">${g.member_count||0}</td>
          <td class="actions"><button class="icon-btn danger" data-del-group="${g.id}" title="Delete">🗑</button></td>
        </tr>
      `).join('');
    }

    async function refreshAll() {
      await loadDepartments();
      await loadGroups();
      // Update the live chat lists if open
      window.refreshChatLists?.();
    }

    // Create handlers
    elDeptBtn.addEventListener('click', async () => {
      const name = (elDeptName.value||'').trim();
      if (!name) return;
      const r = await fetch('/api/departments', {
        method:'POST', credentials:'include',
        headers:{'content-type':'application/json'},
        body: JSON.stringify({ name })
      });
      if (!r.ok) { toast('Create failed','error'); return; }
      elDeptName.value = '';
      await refreshAll();
    });

    elGrpBtn.addEventListener('click', async () => {
      const name = (elGrpName.value||'').trim();
      const dep  = elGrpDept.value;
      if (!name || !dep) return;
      const r = await fetch('/api/groups', {
        method:'POST', credentials:'include',
        headers:{'content-type':'application/json'},
        body: JSON.stringify({ name, department_id: dep })
      });
      if (!r.ok) { toast('Create failed','error'); return; }
      elGrpName.value = '';
      await refreshAll();
    });

    // Delete handlers (event delegation)
    card.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-del-dept],[data-del-group]');
      if (!btn) return;

      // dept delete
      if (btn.dataset.delDept) {
        const id = btn.dataset.delDept;
        if (!confirm('Delete this department? You must first remove its groups, threads and members.')) return;
        const res = await fetch(`/api/departments?id=${encodeURIComponent(id)}`, {
          method:'DELETE', credentials:'include'
        });
        if (res.status === 409) {
          const j = await res.json().catch(()=>null);
          toast(j?.detail || 'Cannot delete: still in use', 'error');
          return;
        }
        if (!res.ok) { toast('Delete failed','error'); return; }
        await refreshAll();
        return;
      }

      // group delete
      if (btn.dataset.delGroup) {
        const id = btn.dataset.delGroup;
        if (!confirm('Delete this group? You must first remove its threads and members.')) return;
        const res = await fetch(`/api/groups?id=${encodeURIComponent(id)}`, {
          method:'DELETE', credentials:'include'
        });
        if (res.status === 409) {
          const j = await res.json().catch(()=>null);
          toast(j?.detail || 'Cannot delete: still in use', 'error');
          return;
        }
        if (!res.ok) { toast('Delete failed','error'); return; }
        await refreshAll();
        return;
      }
    });

    // initial load
    refreshAll();
  }

  // ===== Users table render (Name • Role • Privileges • Actions) =====
  async function renderUsersTable() {
    const table = document.getElementById("usersTable");
    if (!table) return;
    const tbody = table.querySelector("tbody");
    const summary = document.getElementById("usersSummary"); // optional badge you may have

    // Fetch enriched users (name, role, permissions[], nickname/display_name, depts/groups)
    const res = await fetch("/api/admin/users.details", { credentials: "include" });
    let data;
    try { data = await res.json(); } catch { data = []; }
    if (!res.ok) {
      console.warn("users.details failed:", data);
      tbody.innerHTML = `<tr><td colspan="4">Failed to load users</td></tr>`;
      return;
    }

    const esc = s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
    const initials = name => String(name||"").trim().split(/\s+/).slice(0,2).map(p=>p[0]?.toUpperCase()||"").join("");
    const roleLabel = r => r === "Admin" ? "SuperAdmin" : (r || "Member");

    tbody.innerHTML = data.map(u => {
      const avatar = u.avatar_url
        ? `<img class="avatar sm" src="/cdn/${encodeURIComponent(u.avatar_url)}" alt="${esc(u.name)}">`
        : `<span class="avatar sm initials">${initials(u.name)}</span>`;

      // Limit shown chips; reveal rest on click
      const maxChips = 8;
      const chips = (u.permissions || []).map(p => `<span class="chip perm">${esc(p)}</span>`);
      const shown = chips.slice(0, maxChips).join(" ");
      const extra = chips.length > maxChips ? chips.slice(maxChips).join(" ") : "";
      const moreBtn = chips.length > maxChips
        ? `<button class="link-btn show-more" data-user="${u.id}" aria-label="Show all permissions">+${chips.length - maxChips} more</button>`
        : "";

      return `
        <tr data-user-id="${u.id}">
          <td style="min-width:260px">
            <div class="row gap">
              ${avatar}
              <div>
                <div class="name">${esc(u.name)}</div>
                <div class="muted" style="font-size:.85em">${esc(u.email || "")}</div>
              </div>
            </div>
          </td>
          <td style="white-space:nowrap">${esc(roleLabel(u.role))}</td>
          <td>
            <div class="perm-wrap">
              <span class="chips">${shown}</span>
              ${moreBtn}
              ${extra ? `<span class="chips extra" hidden>${extra}</span>` : ""}
            </div>
          </td>
          <td class="actions" style="white-space:nowrap">
            <button class="btn xs" data-act="edit"    data-id="${u.id}">Edit</button>
            <button class="btn xs warn" data-act="disable" data-id="${u.id}">Disable</button>
            <button class="btn xs danger" data-act="delete" data-id="${u.id}">Delete</button>
          </td>
        </tr>
      `;
    }).join("");

    if (summary) summary.textContent = `${data.length} user${data.length===1?"":"s"}`;

    // Toggle “+N more”
    tbody.querySelectorAll(".show-more").forEach(btn => {
      btn.addEventListener("click", () => {
        const row = btn.closest("tr");
        const extra = row.querySelector(".chips.extra");
        if (!extra) return;
        const shown = row.querySelector(".perm-wrap .chips");
        extra.hidden = !extra.hidden;
        btn.textContent = extra.hidden ? `+${extra.textContent.match(/class="chip/g)?.length || 0} more` : "Show less";
        if (!extra.hidden && shown) shown.insertAdjacentElement("afterend", extra);
      });
    });

    // Actions
    tbody.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const row = btn.closest("tr");

      if (act === "edit") {
        // hook your existing form
        // openForm(user) pattern (expects your renderAdmin form to exist)
        // You can pass the full user by reusing `data`:
        const u = data.find(x => x.id === id);
        window.openAdminUserForm?.(u); // if you have a helper, else no-op
        return;
      }

      if (act === "disable") {
        // backend should implement /api/admin/users.disable (or similar)
        // graceful fallback if not present:
        const ok = confirm("Disable this user?");
        if (!ok) return;
        const res = await fetch(`/api/admin/users.disable?id=${encodeURIComponent(id)}`, {
          method: "POST", credentials: "include"
        });
        if (!res.ok) {
          console.warn("disable failed", await res.text());
          alert("Disable failed");
          return;
        }
        row.classList.add("is-disabled");
        return;
      }

      if (act === "delete") {
        const ok = confirm("Delete this user? This cannot be undone.");
        if (!ok) return;
        // expect a real delete route; adjust to your actual path if different
        const res = await fetch(`/api/admin/users.delete?id=${encodeURIComponent(id)}`, {
          method: "POST", credentials: "include"
        });
        if (!res.ok) {
          console.warn("delete failed", await res.text());
          alert("Delete failed");
          return;
        }
        row.remove();
      }
    });
  }


  // ---- Settings: Nickname / Use nickname ----
  function installNicknameSettings(){
    const card = document.getElementById("userSettingsCard");
    if (!card) return;

    const section = document.createElement("section");
    section.innerHTML = `
      <h3 class="panel-sub">Display name</h3>
      <div class="form-row">
        <label>Nickname
          <input type="text" id="setNickname" maxlength="80" placeholder="Optional nickname">
        </label>
        <label class="form-inline">
          <input type="checkbox" id="setUseNickname">
          <span>Use nickname in organization</span>
        </label>
      </div>
      <div class="btn-row">
        <button class="btn" id="btnSaveNickname">Save</button>
      </div>
    `;
    card.appendChild(section);

    // Load
    (async () => {
      try {
        const r = await fetch("/api/me.prefs", { credentials:"include" });
        if (!r.ok) return;
        const prefs = await r.json();
        const nn = document.getElementById("setNickname");
        const cb = document.getElementById("setUseNickname");
        nn.value = prefs?.nickname || "";
        cb.checked = !!prefs?.use_nickname;
      } catch {}
    })();

    document.getElementById("btnSaveNickname")?.addEventListener("click", async () => {
      const nickname = (document.getElementById("setNickname")?.value || "").trim();
      const use_nickname = !!document.getElementById("setUseNickname")?.checked;
      const r = await fetch("/api/me.prefs", {
        method:"POST", credentials:"include",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify({ nickname, use_nickname })
      });
      if (r.ok) {
        // Soft feedback
        const hint = document.getElementById("userSettingsHint");
        if (hint) { hint.textContent = "Saved."; setTimeout(()=>{ hint.textContent="Personalize your experience"; }, 1500); }
      }
    });
  }

  // ---- small utils ----
  function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
  function initials(name){
    const parts = String(name||"").trim().split(/\s+/).slice(0,2);
    return parts.map(p=>p[0]?.toUpperCase()||"").join("");
  }
})();
