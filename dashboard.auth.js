(() => {
  'use strict';
  const $ = (sel, el = document) => el.querySelector(sel);
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
  function toast(msg){ const t=document.createElement('div'); t.className='toast'; t.textContent=msg; (document.getElementById('toasts')||(()=>{const x=document.createElement('div');x.id='toasts';x.className='toasts';document.body.appendChild(x);return x;})()).appendChild(t); setTimeout(()=>t.remove(), 3200); }
  async function api(path){ const res = await fetch(path, { credentials:'include' }); const data = await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.error||'Auth error'); return data; }
  async function requireAuth(){
    try {
      const { user } = await api('/api/me');
      window.__PU_ME__ = user;
      const orgSel = $('#orgSelect'); if (orgSel && !orgSel.querySelector('option[value="me"]')) { const opt = document.createElement('option'); opt.value='me'; opt.textContent=user.name || user.email; orgSel.appendChild(opt); orgSel.value='me'; }
      return user;
    } catch {
      location.href = '/index.html#login';
      return null;
    }
  }
  on(window, 'DOMContentLoaded', async () => {
    const me = await requireAuth(); if (!me) return;
    let tries = 0;
    const wait = setInterval(() => {
      tries++;
      const state = window.state;
      if (state || tries > 200) {
        clearInterval(wait);
        if (!state) { toast('Failed to initialize app state'); return; }
        state.ui = state.ui || {};
        state.ui.role = me.role || 'Member';
        state.users = state.users && state.users.length ? state.users : [{
          id: me.id, name: me.name || me.email, email: me.email, role: me.role || 'Member',
          privileges: me.role === 'Admin' ? ['*'] : ['users.read'], password: '—', createdAt: Date.now()
        }];
        const roleSel = $('#roleSelect'); if (roleSel) roleSel.value = state.ui.role;
        if (typeof window.renderAdminUsers === 'function') { try { window.renderAdminUsers(); } catch {} }
      }
    }, 50);
  });
  window.logoutPU = async function(){
    try { await fetch('/api/logout', { method:'POST', credentials:'include' }); } catch {}
    location.href = '/index.html#login';
  };
})();
