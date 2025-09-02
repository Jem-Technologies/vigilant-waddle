(async function boot() {
  try {
    // 1) Auth check
    const meRes = await fetch("/api/me", { method: "GET", credentials: "include" });
    const me = await meRes.json().catch(() => ({}));
    if (!meRes.ok || !me?.auth) {
      location.href = "/index.html#login";
      return;
    }

    // Expose for other scripts
    window.currentUser = me.user;   // { id, name, username, email, role }
    window.currentOrg  = me.org;    // { id, slug, name }

    // 2) Populate UI placeholders
    fillTextAll("[data-user-name]", me.user.name || me.user.username || me.user.email);
    fillTextAll("[data-user-role]", me.user.role);
    fillTextAll("[data-org-name]",  me.org?.name || "");
    fillTextAll("[data-org-slug]",  me.org?.slug || "");

    // optional: initials avatar
    const initials = computeInitials(me.user.name || me.user.username || "");
    fillTextAll("[data-user-initials]", initials);

    // 3) Role-based visibility (optional)
    toggleRoleBlocks(me.user.role);

    // 4) Admin panel: load org users if present
    const adminPanel = document.querySelector("[data-admin-users]");
    if (adminPanel && (me.user.role === "Admin" || me.user.role === "Manager")) {
      try {
        const r = await fetch("/api/admin/users", { credentials: "include" });
        const d = await r.json().catch(() => ({}));
        if (r.ok && Array.isArray(d.users)) {
          const tbody = adminPanel.querySelector("tbody") || adminPanel;
          tbody.innerHTML = d.users.map(u => `
            <tr>
              <td>${escapeHtml(u.name)}</td>
              <td>${escapeHtml(u.email)}</td>
              <td>${escapeHtml(u.username)}</td>
              <td>${escapeHtml(u.role)}</td>
            </tr>
          `).join("");
        } else {
          console.warn("admin/users bad response:", d);
        }
      } catch (e) {
        console.warn("admin/users load failed:", e);
      }
    }

    // 5) Logout hook (if you add a button anywhere)
    const logoutBtn = document.querySelector("[data-logout]");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        try {
          await fetch("/api/logout", { method: "POST", credentials: "include" });
        } catch {}
        location.href = "/index.html#login";
      });
    }

  } catch (e) {
    console.error("Failed to initialize app state:", e);
    alert("Failed to initialize app state. Please refresh, or log in again.");
    location.href = "/index.html#login";
  }

  // ---------- helpers ----------
  function fillTextAll(selector, text) {
    document.querySelectorAll(selector).forEach(el => { el.textContent = text; });
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    }[m]));
  }
  function computeInitials(s) {
    const parts = String(s || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    const letters = (parts[0][0] || "") + (parts[1]?.[0] || "");
    return letters.toUpperCase();
  }
  function toggleRoleBlocks(role) {
    // Elements visible only to Admin or Manager
    document.querySelectorAll("[data-admin-only]").forEach(el => {
      el.style.display = (role === "Admin") ? "" : "none";
    });
    document.querySelectorAll("[data-manager-only]").forEach(el => {
      el.style.display = (role === "Admin" || role === "Manager") ? "" : "none";
    });
  }
})();