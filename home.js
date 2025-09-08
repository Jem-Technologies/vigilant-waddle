(()=> {
  // ---------- Helpers ----------
  const $  = (s, d=document) => d.querySelector(s);
  const $$ = (s, d=document) => Array.from(d.querySelectorAll(s));
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn, { passive:false });

  // Top-center, safe-area-aware toast
  const toast = (msg, opts = {}) => {
    const { kind='default', ms=2600 } = opts;
    let wrap = document.getElementById('toasts');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toasts';
      wrap.setAttribute('aria-live', 'polite');
      wrap.setAttribute('role', 'status');
      wrap.style.cssText = [
        'position:fixed',
        'left:50%',
        'top:calc(env(safe-area-inset-top, 0px) + 16px)',
        'transform:translateX(-50%)',
        'display:flex',
        'flex-direction:column',
        'gap:8px',
        'z-index:2147483647',
        'pointer-events:none',
        'max-width:min(92vw, 520px)',
        'padding:0 8px'
      ].join(';');
      document.body.appendChild(wrap);
    }
    const t = document.createElement('div');
    t.className = `toast toast-${kind}`;
    t.textContent = msg;
    t.setAttribute('role','alert');
    t.style.cssText = [
      'pointer-events:auto',
      'background:#111418',
      'color:#fff',
      'border-radius:12px',
      'padding:12px 14px',
      'box-shadow:0 10px 30px rgba(0,0,0,.35)',
      'font-size:14px',
      'line-height:1.35',
      'opacity:0',
      'transform:translateY(-8px)',
      'transition:opacity .18s ease, transform .18s ease',
      kind==='info'    ? 'border-left:4px solid #3b82f6' :
      kind==='warn'    ? 'border-left:4px solid #f59e0b' :
      kind==='error'   ? 'border-left:4px solid #ef4444' :
      kind==='success' ? 'border-left:4px solid #10b981' :
                         'border-left:4px solid #64748b'
    ].join(';');
    wrap.appendChild(t);
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
    requestAnimationFrame(()=>{ t.style.opacity='1'; t.style.transform='translateY(0)'; });
    const ttl = Math.max(1500, ms|0);
    setTimeout(()=>{
      t.style.opacity='0'; t.style.transform='translateY(-8px)';
      setTimeout(()=> t.remove(), 220);
    }, ttl);
  };

  // org helpers
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
      credentials: "include",
      body: JSON.stringify(payload)
    });
    let data; try { data = await res.json(); } catch { data = { error: "No JSON body" }; }
    if (!res.ok) {
      const err = new Error(data?.error || data?.detail || `Request failed (${res.status})`);
      err.status  = res.status;
      err.code    = data?.code || data?.where || null;
      err.payload = data;
      throw err;
    }
    return data;
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = !!busy;
    if (busy) {
      if (!btn.dataset._label) btn.dataset._label = btn.textContent || btn.value || 'Submit';
      if ('textContent' in btn) btn.textContent = 'Please wait…';
      if ('value' in btn) btn.value = 'Please wait…';
      btn.setAttribute('aria-busy', 'true');
      btn.classList.add('is-loading');
    } else {
      const label = btn.dataset._label;
      if (label) {
        if ('textContent' in btn) btn.textContent = label;
        if ('value' in btn) btn.value = label;
        delete btn.dataset._label;
      }
      btn.removeAttribute('aria-busy');
      btn.classList.remove('is-loading');
    }
  }

  // ---------- Router ----------
  const routes = [
    '/', '/problem', '/solution', '/features', '/integrations',
    '/advantages', '/pricing', '/case-studies', '/faq', '/contact'
  ];
  function showRoute(route){
    $$('section.route').forEach(sec => {
      const r = sec.getAttribute('data-route');
      sec.hidden = (r !== route);
    });
    $$('.nav-center .nav-link').forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === '#'+route);
    });
    closeMobile();
    window.scrollTo({top:0, behavior:'smooth'});
  }
  function navigate(hash){
    const route = (hash||'').replace(/^#/, '') || '/';
    if (!routes.includes(route)) return showRoute('/');
    showRoute(route);
  }
  on(window, 'hashchange', () => navigate(location.hash));

  // ---------- Header interactions ----------
  function closeMobile(){
    const nav = $('#mobileNav'); const btn = $('#openMobileNav');
    if (nav && nav.classList.contains('open')) {
      nav.classList.remove('open'); btn.setAttribute('aria-expanded','false');
    }
  }
  on($('#openMobileNav'),'click', ()=>{
    const nav = $('#mobileNav'); const btn = $('#openMobileNav');
    nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false');
  });

  const loginModal  = $('#loginModal');
  const signupModal = $('#signupModal');

  ['openLogin','openSignup','openLoginM','openSignupM','ctaSignup','ctaSignup2','footerSignup']
    .forEach(id=>{
      on($('#'+id), 'click', ()=>{
        if (id.toLowerCase().includes('login')) { loginModal?.showModal(); }
        else                                     { signupModal?.showModal(); }
      });
    });
  on($('#swapToSignup'), 'click', ()=>{ loginModal?.close(); signupModal?.showModal(); });
  on($('#swapToLogin'),  'click', ()=>{ signupModal?.close(); loginModal?.showModal(); });

  // backdrop click closes
  [loginModal, signupModal].forEach(dlg=>{
    on(dlg, 'click', (e)=>{
      const card = dlg.querySelector('.modal-card'); if (!card) return;
      const r = card.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) dlg.close();
    });
  });

  // ---------- AUTH Forms ----------
  // LOGIN
  const loginForm = $('#loginForm');
  const loginBtn  = $('#loginSubmit');
  if (loginForm) {
    const pathOrg = getOrgFromPath();
    const orgInput = $('#loginOrg');
    if (pathOrg && orgInput) { orgInput.closest('label').style.display='none'; orgInput.removeAttribute('required'); }

    async function doLogin(pathOrg){
      const id = $('#loginId')?.value.trim();
      const password = $('#loginPwd')?.value.trim();
      let org = pathOrg;
      if (!org) {
        const raw = $('#loginOrg')?.value.trim();
        if (!raw) { toast('Please enter your Organization', {kind:'warn'}); return; }
        org = slugifyOrg(raw);
      }
      const btn = $('#loginSubmit');
      try {
        setBusy(btn, true);
        await apiPost('/api/login', { id, password, org });
        location.href = '/dashboard.html';
      } catch (err) {
        toast(`Login failed: ${err.message}`, {kind:'error'});
      } finally {
        setBusy(btn, false);
      }
    }

    on(loginForm, 'submit', async (e)=>{ e.preventDefault(); await doLogin(pathOrg); });
    on(loginBtn,  'click',  async (e)=>{ e.preventDefault(); await doLogin(pathOrg); });
  }

  // SIGNUP
  const signupForm = $('#signupForm');
  const signupBtn  = $('#signupSubmit');
  if (signupForm) {
    // timezones
    const tzSel = $('#suTz');
    if (tzSel) {
      const tzs = ['UTC','America/Los_Angeles','America/Denver','America/Chicago','America/New_York',
        'Europe/London','Europe/Berlin','Europe/Paris','Africa/Lagos','Asia/Dubai','Asia/Kolkata','Asia/Singapore','Asia/Tokyo','Australia/Sydney'];
      tzs.forEach(z=>{ const o=document.createElement('option'); o.value=o.textContent=z; tzSel.appendChild(o); });
      try{ tzSel.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }catch{}
    }

    // strength meter
    const suPwd=$('#suPwd'), suPwd2=$('#suPwd2'), meter=$('#pwdStrength');
    const score=(p='')=>{ let s=0; if(p.length>=8)s++; if(/[A-Z]/.test(p))s++; if(/[a-z]/.test(p))s++; if(/[0-9\W]/.test(p))s++; return s; };
    on(suPwd,'input',()=> meter && (meter.value = score(suPwd.value||'')));

    async function doSignup(){
      const name     = $('#suName')?.value.trim();
      const username = $('#suUser')?.value.trim();
      const email    = $('#suEmail')?.value.trim();
      const company  = $('#suCompany')?.value.trim();
      const pass1    = $('#suPwd')?.value;
      const pass2    = $('#suPwd2')?.value;
      const tosOk    = $('#suTos')?.checked;

      if (!name || !username || !email) return toast('Please complete required fields', {kind:'warn'});
      if ((pass1||'').length < 8)      return toast('Password must be at least 8 characters', {kind:'warn'});
      if (pass1 !== pass2)             return toast('Passwords do not match', {kind:'warn'});
      if (!tosOk)                      return toast('Please accept Terms & Privacy', {kind:'warn'});

      const pathOrg  = getOrgFromPath();
      const fieldOrg = slugifyOrg($('#suOrg')?.value || '');
      const org      = pathOrg || fieldOrg || slugifyOrg(username);

      const btn = $('#signupSubmit');
      try {
        setBusy(btn, true);
        const res = await apiPost('/api/signup', {
          name, username, email, password: pass1, org, orgName: company || undefined
        });

        if (res?.alreadyExists) {
          toast('Account already exists. Redirecting to login…', {kind:'info'});
          setTimeout(()=> location.href = '/login.html', 700);
          return;
        }

        location.href = '/dashboard.html';

      } catch (err) {
        if (err.status === 409) {
          switch (err.code) {
            case 'EMAIL_TAKEN':
              toast('This email is already registered. Please login instead.', {kind:'warn'});
              setTimeout(()=> location.href = '/login.html', 900);
              return;
            case 'EMAIL_TAKEN_PWD':
              toast('That email is registered, but the password does not match. Please login.', {kind:'warn'});
              setTimeout(()=> location.href = '/login.html', 900);
              return;
            case 'USERNAME_TAKEN':
              toast('That username is already taken. Pick another.', {kind:'warn'});
              $('#suUser')?.focus();
              return;
            case 'ORG_TAKEN':
              toast('That workspace name is taken. Choose a different name.', {kind:'warn'});
              $('#suOrg')?.focus();
              return;
            case 'USER_ORG_EXISTS':
              toast('You already belong to this workspace. Redirecting to login…', {kind:'info'});
              setTimeout(()=> location.href = '/login.html', 900);
              return;
            default:
              // fallthrough
          }
        }
        toast(`Signup failed: ${err.message}`, {kind:'error'});
      } finally {
        setBusy(btn, false);
      }
    }

    on(signupForm,'submit', async (e)=>{ e.preventDefault(); await doSignup(); });
    on(signupBtn,  'click',  async (e)=>{ e.preventDefault(); await doSignup(); });
  }

  // ---------- Contact form ----------
  on($('#contactForm'), 'submit', (e)=>{
    e.preventDefault();
    toast('Thanks! We will get back to you shortly.', {kind:'success'});
    e.target.reset();
  });

  // ---------- Page boot ----------
  const y = $('#year'); if (y) y.textContent = new Date().getFullYear();
  if (!location.hash) location.hash = '#/';
  navigate(location.hash);

  // Accessibility: focus outlines for keyboard only
  let mouseDown = false;
  on(window,'mousedown',()=>{ mouseDown=true; document.body.classList.add('using-mouse'); });
  on(window,'keydown',()=>{ if(mouseDown){ mouseDown=false; document.body.classList.remove('using-mouse'); } });

  // Auto-open signup from pricing buttons
  $$('.openSignupAuto').forEach(b=> on(b,'click', ()=> signupModal?.showModal() ));

  // Diagnostics
  console.log('home.js boot OK', { login: !!$('#loginForm'), signup: !!$('#signupForm') });
})();
