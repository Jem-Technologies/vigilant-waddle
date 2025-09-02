// home.js — org-aware auth wired to your exact form IDs (final hardening)

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
      credentials: "include",              // ensure Set-Cookie is honored
      body: JSON.stringify(payload)
    });
    let data;
    try { data = await res.json(); } catch { data = { error: "No JSON body" }; }
    if (!res.ok) {
      const msg =
        data?.error ||
        data?.detail ||
        (data?.where ? `${data.where}: ${JSON.stringify(data)}` : JSON.stringify(data));
      throw new Error(msg);
    }
    return data;
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = !!busy;
    if (busy) {
      btn.dataset._label = btn.textContent;
      btn.textContent = "Please wait…";
    } else {
      if (btn.dataset._label) btn.textContent = btn.dataset._label;
      delete btn.dataset._label;
    }
  }

  // ---------- LOGIN ----------
  const loginForm = document.querySelector("#loginForm");
  const loginBtn  = document.querySelector("#loginSubmit");
  if (loginForm) {
    // hide org input if already in /o/{slug}/
    const orgFromPath = getOrgFromPath();
    const orgInput = document.querySelector("#loginOrg");
    if (orgFromPath && orgInput) {
      const parentLabel = orgInput.closest("label");
      if (parentLabel) parentLabel.style.display = "none";
      orgInput.removeAttribute("required");
    }

    // main submit
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await doLogin(orgFromPath);
    });

    // direct click fallback
    if (loginBtn) {
      loginBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        await doLogin(orgFromPath);
      });
    }
  }

  async function doLogin(orgFromPath) {
    const id = (document.querySelector("#loginId")?.value || "").trim();
    const password = (document.querySelector("#loginPwd")?.value || "").trim();

    let org = orgFromPath;
    if (!org) {
      const raw = (document.querySelector("#loginOrg")?.value || "").trim();
      if (!raw) { alert("Please enter your Organization (e.g., jemtech)."); return; }
      org = slugifyOrg(raw);
    }

    const submitBtn = document.querySelector('#loginSubmit');
    try {
      setBusy(submitBtn, true);
      await apiPost("/api/login", { id, password, org });
      // session is org-scoped → flat dashboard path works
      location.href = "/dashboard.html";
    } catch (err) {
      alert(`Login failed: ${err.message}`);
    } finally {
      setBusy(submitBtn, false);
    }
  }

  // ---------- SIGNUP ----------
  const signupForm = document.querySelector("#signupForm");
  const signupBtn  = document.querySelector("#signupSubmit");
  if (signupForm) {
    const pwd = document.querySelector("#suPwd");
    const pwd2 = document.querySelector("#suPwd2");
    const strength = document.querySelector("#pwdStrength");

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

    // main submit
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await doSignup();
    });

    // direct click fallback
    if (signupBtn) {
      signupBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        await doSignup();
      });
    }
  }

  async function doSignup() {
    const name     = (document.querySelector("#suName")?.value || "").trim();
    const username = (document.querySelector("#suUser")?.value || "").trim();
    const email    = (document.querySelector("#suEmail")?.value || "").trim();
    const company  = (document.querySelector("#suCompany")?.value || "").trim();
    const pass1    = (document.querySelector("#suPwd")?.value || "").trim();
    const pass2    = (document.querySelector("#suPwd2")?.value || "").trim();

    if (pass1 !== pass2) { alert("Passwords do not match."); return; }
    if (!document.querySelector("#suTos")?.checked) { alert("You must agree to the Terms & Privacy."); return; }

    // org: URL (/o/{slug}/) OR #suOrg field OR derive from username
    const orgFromPath = getOrgFromPath();
    const orgField    = slugifyOrg(document.querySelector("#suOrg")?.value || "");
    const org         = orgFromPath || orgField || slugifyOrg(username);

    const submitBtn = document.querySelector('#signupSubmit');
    try {
      setBusy(submitBtn, true);
      await apiPost("/api/signup", {
        name,
        username,
        email,
        password: pass1,
        org,
        orgName: company || undefined
      });
      location.href = "/dashboard.html";
    } catch (err) {
      alert(`Signup failed: ${err.message}`);
    } finally {
      setBusy(submitBtn, false);
    }
  }

  // ---------- modal switches ----------
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

  // ---------- diagnostics (optional, keep/remove) ----------
  console.log('home.js loaded; forms present:', {
    loginForm: !!document.querySelector('#loginForm'),
    signupForm: !!document.querySelector('#signupForm')
  });
})();
