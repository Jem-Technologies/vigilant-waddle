<script>
(async function boot() {
  try {
    // 1) check auth
    const meRes = await fetch("/api/me", { method:"GET", credentials:"include" });
    const me = await meRes.json().catch(()=>({}));
    if (!meRes.ok || !me?.auth) {
      // not logged in → go back to landing login
      location.href = "/index.html#login";
      return;
    }

    // 2) set UI name/role if you have placeholders
    window.currentUser = me.user;
    const roleBadge = document.querySelector("[data-role-badge]");
    if (roleBadge) roleBadge.textContent = me.user.role;

    // 3) try to load admin users (only if admin panel exists)
    const adminPanel = document.querySelector("[data-admin-users]");
    if (adminPanel && (me.user.role === "Admin" || me.user.role === "Manager")) {
      try {
        const r = await fetch("/api/admin/users", { credentials:"include" });
        const d = await r.json().catch(()=>({}));
        if (r.ok && Array.isArray(d.users)) {
          // render rows (adapt to your table)
          const tbody = adminPanel.querySelector("tbody") || adminPanel;
          tbody.innerHTML = d.users.map(u => `
            <tr>
              <td>${escapeHtml(u.name)}</td>
              <td>${escapeHtml(u.email)}</td>
              <td>${escapeHtml(u.username)}</td>
              <td>${escapeHtml(u.role)}</td>
            </tr>
          `).join("");
        }
      } catch(e) {
        console.warn("admin/users load failed:", e);
      }
    }

  } catch (e) {
    console.error("Failed to initialize app state:", e);
    alert("Failed to initialize app state. Please refresh, or log in again.");
    location.href = "/index.html#login";
  }

  function escapeHtml(s){return String(s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
})();
</script>
