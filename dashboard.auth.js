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

  // ---- Users & Roles ----
  async function renderUsersExtended(){
    const table = document.getElementById("usersTable");
    const summary = document.getElementById("usersSummary");
    if (!table) return;

    let data = [];
    try {
      const r = await fetch("/api/admin/users.details", { credentials:"include" });
      data = await r.json().catch(()=>[]);
      if (!r.ok) throw new Error("users.details failed");
    } catch (e) {
      console.warn("users.details error:", e);
      return;
    }

    const tbody = table.querySelector("tbody");
    tbody.innerHTML = data.map(u => {
      const deps = u.departments.map(d => `<span class="chip">${escapeHtml(d.name)}</span>`).join(" ");
      const grps = u.groups.map(g => `<span class="chip">${escapeHtml(g.name)}</span>`).join(" ");
      const perms = u.permissions.map(p => `<span class="chip quiet">${escapeHtml(p)}</span>`).join(" ");
      const nick = u.nickname ? escapeHtml(u.nickname) : `<span class="muted">Not set</span>`;
      const avatar = u.avatar_url ? `<img class="avatar sm" src="/cdn/${encodeURIComponent(u.avatar_url)}" alt="">` : `<span class="avatar sm initials">${initials(u.display_name || u.name)}</span>`;
      return `
        <tr data-user-id="${u.id}">
          <td style="white-space:nowrap">${avatar}</td>
          <td>
            <div style="font-weight:600">${escapeHtml(u.name)}</div>
            <div class="muted" style="font-size:.85em">${escapeHtml(u.email)}</div>
          </td>
          <td>${escapeHtml(u.username || "—")}</td>
          <td>${escapeHtml(u.role)}</td>
          <td>${deps || "—"}</td>
          <td>${grps || "—"}</td>
          <td>${nick}</td>
          <td style="max-width:360px">${perms || "—"}</td>
        </tr>
      `;
    }).join("");

    summary.textContent = `${data.length} user${data.length===1?"":"s"} in ${window.currentOrg?.name || "org"}`;
  }

  // ---- Admin Chat & Conversations card ----
  function installChatConversationsAdminCard(){
    const anchorCard = document.getElementById("adminUsersCard");
    if (!anchorCard) return;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <header class="panel-header">
        <h2>Chat & Conversations</h2>
        <span class="muted">Create departments and groups. Changes appear in Chats immediately.</span>
      </header>
      <div class="grid-2">
        <section>
          <h3 class="panel-sub">New Department</h3>
          <div class="form-row">
            <label>Department name
              <input type="text" id="newDeptName" placeholder="e.g., Sales">
            </label>
          </div>
          <button class="btn" id="btnCreateDept">Create Department</button>
        </section>
        <section>
          <h3 class="panel-sub">New Group</h3>
          <div class="form-row">
            <label>Group name
              <input type="text" id="newGroupName" placeholder="e.g., Q3 Campaign">
            </label>
            <label>Department
              <select id="newGroupDept"></select>
            </label>
          </div>
          <button class="btn" id="btnCreateGroup">Create Group</button>
        </section>
      </div>
    `;
    anchorCard.insertAdjacentElement("afterend", card);

    // Populate department select
    refreshDepartments();

    document.getElementById("btnCreateDept")?.addEventListener("click", async () => {
      const name = (document.getElementById("newDeptName")?.value || "").trim();
      if (!name) return;
      const r = await fetch("/api/departments", {
        method:"POST", credentials:"include",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify({ name })
      });
      if (r.ok) {
        document.getElementById("newDeptName").value = "";
        await refreshDepartments();
        window.refreshChatLists?.();
      } else {
        console.warn("create dept failed", await r.text());
      }
    });

    document.getElementById("btnCreateGroup")?.addEventListener("click", async () => {
      const name = (document.getElementById("newGroupName")?.value || "").trim();
      const dep  = document.getElementById("newGroupDept")?.value;
      if (!name || !dep) return;
      const r = await fetch("/api/groups", {
        method:"POST", credentials:"include",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify({ name, department_id: dep })
      });
      if (r.ok) {
        document.getElementById("newGroupName").value = "";
        window.refreshChatLists?.();
      } else {
        console.warn("create group failed", await r.text());
      }
    });

    async function refreshDepartments(){
      const sel = document.getElementById("newGroupDept");
      const r = await fetch("/api/departments", { credentials:"include" });
      const arr = await r.json().catch(()=>[]);
      sel.innerHTML = `<option value="">Select a department…</option>` + arr.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("");
    }
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
