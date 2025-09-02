(() => {
  const $  = (s, d=document) => d.querySelector(s);
  const $$ = (s, d=document) => Array.from(d.querySelectorAll(s));
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn, {passive:false});
  const toast = (msg) => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    const wrap = document.getElementById('toasts') || (() => {
      const x = document.createElement('div');
      x.id = 'toasts';
      x.style.position='fixed'; x.style.right='16px'; x.style.bottom='16px'; x.style.display='flex';
      x.style.flexDirection='column'; x.style.gap='8px'; x.style.zIndex='9999';
      document.body.appendChild(x); return x;
    })();
    t.style.cssText = 'background:#111418;color:#fff;border-radius:10px;padding:10px 12px;box-shadow:0 6px 18px rgba(0,0,0,.25)';
    wrap.appendChild(t); setTimeout(()=>t.remove(), 2400);
  };

  const routes = ['/', '/problem', '/solution', '/features', '/integrations','/advantages', '/pricing', '/case-studies', '/faq', '/contact'];
  function showRoute(route){
    $$('section.route').forEach(sec => { sec.hidden = (sec.getAttribute('data-route') !== route); });
    $$('.nav-center .nav-link').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#'+route));
    closeMobile(); window.scrollTo({top:0, behavior:'smooth'});
  }
  function navigate(hash){ const route = (hash||'').replace(/^#/, '') || '/'; if (!routes.includes(route)) return showRoute('/'); showRoute(route); }
  function closeMobile(){ const nav = $('#mobileNav'); const btn = $('#openMobileNav'); if (nav && nav.classList.contains('open')) { nav.classList.remove('open'); btn.setAttribute('aria-expanded','false'); } }
  on($('#openMobileNav'),'click', ()=>{ const nav=$('#mobileNav'); const btn=$('#openMobileNav'); nav.classList.toggle('open'); btn.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false'); });

  const loginModal  = $('#loginModal');
  const signupModal = $('#signupModal');
  ['openLogin','openSignup','openLoginM','openSignupM','ctaSignup','ctaSignup2','footerSignup']
    .forEach(id=>{ on($('#'+id), 'click', ()=>{ id.toLowerCase().includes('login') ? loginModal.showModal() : signupModal.showModal(); }); });
  on($('#swapToSignup'), 'click', ()=>{ loginModal.close(); signupModal.showModal(); });
  on($('#swapToLogin'),  'click', ()=>{ signupModal.close(); loginModal.showModal(); });
  [loginModal, signupModal].forEach(dlg=>{ on(dlg, 'click', (e)=>{ const rect = dlg.querySelector('.modal-card').getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom; if (!inside) dlg.close(); }); });

  const tzSel = $('#suTz');
  if (tzSel) {
    const tzs = ['UTC','America/Los_Angeles','America/Denver','America/Chicago','America/New_York','Europe/London','Europe/Berlin','Europe/Paris','Africa/Lagos','Asia/Dubai','Asia/Kolkata','Asia/Singapore','Asia/Tokyo','Australia/Sydney'];
    tzs.forEach(z=>{ const o=document.createElement('option'); o.value=o.textContent=z; tzSel.appendChild(o); });
    try{ tzSel.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }catch{}
  }
  const suPwd = $('#suPwd'), suPwd2 = $('#suPwd2'), meter = $('#pwdStrength');
  function score(p=''){ let s=0; if(p.length>=8) s++; if(/[A-Z]/.test(p)) s++; if(/[a-z]/.test(p)) s++; if(/[0-9\W]/.test(p)) s++; return s; }
  on(suPwd,'input',()=> meter.value = score(suPwd.value||''));

  async function api(path, method, payload){
    const res = await fetch(path, { method, headers: {'content-type':'application/json'}, credentials: 'include', body: payload ? JSON.stringify(payload) : undefined });
    const data = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function apiPost(url, payload) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    let data;
    try { data = await res.json(); } catch { data = { error: "No JSON body" }; }
    if (!res.ok) {
      // Surface server error text instead of generic "Unhandled error"
      const msg = data?.error || data?.detail || JSON.stringify(data);
      throw new Error(msg);
   }
    return data;
  }

  // Example: SIGNUP
  async function doSignup({ name, username, email, password }) {
    try {
      const out = await apiPost("/api/signup", { name, username, email, password });
      // success → go to dashboard
      location.href = "/dashboard.html";
    } catch (err) {
      alert(`Signup failed: ${err.message}`); // or your toast/snackbar
    }
  }

  // Example: LOGIN
  async function doLogin({ id, password }) {
    try {
      const out = await apiPost("/api/login", { id, password });
      location.href = "/dashboard.html";
    } catch (err) {
      alert(`Login failed: ${err.message}`);
    }
  }


  on($('#loginForm'),'submit', async (e)=>{
    e.preventDefault();
    const id  = $('#loginId').value.trim();
    const pwd = $('#loginPwd').value.trim();
    if (!id || !pwd) return toast('Please enter your credentials');
    try {
      await api('/api/login', 'POST', { id, password: pwd });
      toast('Welcome back 👋');
      loginModal.close();
      location.href = '/dashboard.html';
    } catch (err) { toast(err.message || 'Login failed'); }
  });

  on($('#signupForm'),'submit', async (e)=>{
    e.preventDefault();
    const name = $('#suName').value.trim();
    const user = $('#suUser').value.trim();
    const email= $('#suEmail').value.trim();
    const pwd1 = $('#suPwd').value;
    const pwd2 = $('#suPwd2').value;
    const tos  = $('#suTos').checked;
    if (!name || !user || !email) return toast('Please complete required fields');
    if (pwd1.length < 8) return toast('Password must be at least 8 characters');
    if (pwd1 !== pwd2)   return toast('Passwords do not match');
    if (!tos)            return toast('Please accept Terms & Privacy');
    try {
      await api('/api/signup', 'POST', { name, username: user, email, password: pwd1 });
      toast('Account created ✅ Redirecting…');
      signupModal.close();
      location.href = '/dashboard.html';
    } catch (err) { toast(err.message || 'Signup failed'); }
  });

  on($('#contactForm'), 'submit', (e)=>{ e.preventDefault(); toast('Thanks! We will get back to you shortly.'); e.target.reset(); });

  const y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
  if (!location.hash) location.hash = '#/'; navigate(location.hash);
  let mouseDown=false; on(window,'mousedown',()=>{ mouseDown=true; document.body.classList.add('using-mouse'); });
  on(window,'keydown',()=>{ if(mouseDown){ mouseDown=false; document.body.classList.remove('using-mouse'); } });
  $$('.openSignupAuto').forEach(b=> on(b,'click', ()=> signupModal.showModal() ));
})();
