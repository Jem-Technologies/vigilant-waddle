// home.js — org-aware auth wired to your exact form IDs

(function () {
  // ---------- helpers ----------
  function getOrgFromPath() {
    try {
      const parts = location.pathname.split("/").filter(Boolean);
      const i = parts.findIndex(p => p === "o" || p === "organization");
      if (i >= 0 && parts[i + 1]) return parts[i + 1].toLowerCase();
    } catch {}
    return null;
  }
  function slugifyOrg(x) {
    return String(x || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  async function apiPost(url, payload) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    let data;
    try { data = await res.json(); } catch { data = { error: "No JSON body" }; }
    if (!res.ok) throw new Error(data?.error || data?.detail || JSON.stringify(data));
    return data;
  }

  // ---------- LOGIN ----------
  const loginForm = document.querySelector("#loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault(); // prevent <form method="dialog"> from auto-closing
      const id = (document.querySelector("#loginId")?.value || "").trim();
      const password = (document.querySelector("#loginPwd")?.value || "").trim();

      // org: prefer URL (/o/{slug}/), else #loginOrg field
      const orgFromPath = getOrgFromPath();
      let org = orgFromPath;
      if (!org) {
        const raw = (document.querySelector("#loginOrg")?.value || "").trim();
        if (!raw) { alert("Please enter your Organization (e.g., rescueroofer)."); return; }
        org = slugifyOrg(raw);
      }

      try {
        await apiPost("/api/login", { id, password, org });
        // Use a flat dashboard URL (session is org-scoped on the server)
        location.href = "/dashboard.html";
      } catch (err) {
        alert(`Login failed: ${err.message}`);
      }
    });
  }

  // ---------- SIGNUP ----------
  const signupForm = document.querySelector("#signupForm");
  if (signupForm) {
    const pwd = document.querySelector("#suPwd");
    const pwd2 = document.querySelector("#suPwd2");
    const strength = document.querySelector("#pwdStrength");

    // (keep your strength meter working)
    if (pwd && strength) {
      pwd.addEventListener("input", () => {
        const v = pwd.value || "";
        let score = 0;
        if (v.length >= 8) score++;
        if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
        if (/\d/.test(v)) score++;
        if (/[^A-Za-z0-9]/.test(v)) score++;
        strength.value = score;
      });
    }

    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault(); // prevent dialog auto-close

      const name     = (document.querySelector("#suName")?.value || "").trim();
      const username = (document.querySelector("#suUser")?.value || "").trim();
      const email    = (document.querySelector("#suEmail")?.value || "").trim();
      const company  = (document.querySelector("#suCompany")?.value || "").trim();
      const pass1    = (document.querySelector("#suPwd")?.value || "").trim();
      const pass2    = (document.querySelector("#suPwd2")?.value || "").trim();

      if (pass1 !== pass2) { alert("Passwords do not match."); return; }

      // org: URL (/o/{slug}/) OR #suOrg field OR derive from username
      const orgFromPath = getOrgFromPath();
      const orgField    = slugifyOrg(document.querySelector("#suOrg")?.value || "");
      const org         = orgFromPath || orgField || slugifyOrg(username);

      try {
        await apiPost("/api/signup", {
          name,
          username,
          email,
          password: pass1,
          org,
          orgName: company || undefined
        });
        // On success go to dashboard (server session is org-scoped)
        location.href = "/dashboard.html";
      } catch (err) {
        alert(`Signup failed: ${err.message}`);
      }
    });
  }

  // ---------- modal switches (keep your UX) ----------
  const swapToSignup = document.querySelector("#swapToSignup");
  const swapToLogin  = document.querySelector("#swapToLogin");
  const loginModal   = document.querySelector("#loginModal");
  const signupModal  = document.querySelector("#signupModal");

  if (swapToSignup && loginModal && signupModal) {
    swapToSignup.addEventListener("click", () => { loginModal.close(); signupModal.showModal(); });
  }
  if (swapToLogin && loginModal && signupModal) {
    swapToLogin.addEventListener("click", () => { signupModal.close(); loginModal.showModal(); });
  }
})();
