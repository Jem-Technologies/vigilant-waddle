/*
  Perfect Unified — app.js
  Fully client-side prototype logic with localStorage persistence, accessible routing,
  role‑aware nav, command palette, search, notifications, tasks/kanban, calendar,
  time tracking, notes, CRM, automations, reports, and theming.

  This file is framework‑free and intentionally verbose for clarity.
  It assumes the DOM structure in index.html and styles in styles.css.
*/

(() => {
  'use strict';

  // ---------- Utilities ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
  const uuid = () => crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36)+Math.random().toString(36).slice(2,8));
  const fmt = (d) => new Date(d).toLocaleString();
  const fmtDate = (d) => new Date(d).toLocaleDateString();
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const download = (name, data, type='text/csv') => {
    const blob = new Blob([data], {type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // Function to convert a hex color to an RGB array
  const hexToRgb = (hex) => {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16)
    ] : null;
  };

  // ---------- Persistence ----------
  const storageKey = 'pu_state_v1';
  const save = () => localStorage.setItem(storageKey, JSON.stringify(state));
  const load = () => {
    try { return JSON.parse(localStorage.getItem(storageKey)) || null; } catch { return null; }
  };

  // ---------- Initial State ----------
  const initialState = {
    ui: {
      role: 'Admin',
      org: 'my-org',
      density: document.documentElement.dataset.density || 'comfortable',
      sidebarOpen: false,
      wallpaper: 'none',
      highContrast: false,
      themePrimary: '#4f46e5',
      presence: 'available'
    },
    notifications: [],
    inbox: { items: [], filter: 'all', selectedId: null },
    chat: { channels: [], activeId: null },
    projects: [],
    tasks: [
      { id: uuid(), title: 'Wire calendar view', bucket: 'today', status: 'todo', due: addDaysStr(0), assignee: 'me' },
      { id: uuid(), title: 'Draft onboarding brief', bucket: 'next', status: 'doing', due: addDaysStr(1), assignee: 'me' },
      { id: uuid(), title: 'Tag notes with #sales', bucket: 'later', status: 'todo', due: addDaysStr(5), assignee: 'me' },
    ],
    time: { runningTaskId: null, startTs: null, entries: [] },
    calendar: { events: seedEvents() },
    notes: [],
    rules: [],
    sequences: [],
    dna: { mission: '', formal: 50, playful: 50, enth: 50, banned: '' },
    billing: { invoices: [], subs: [] },
    crm: { deals: seedDeals() },
    twin: { cols: 12, desks: seedDesks() },
    reports: seedReports(),
  };

  function addDaysStr(n) {
    const d = new Date(); d.setDate(d.getDate()+n); return d.toISOString();
  }
  function seedEvents() {
    const start = new Date(); start.setHours(10,0,0,0);
    const end = new Date(); end.setHours(11,0,0,0);
    return [ { id: uuid(), title: 'Stand‑up', start: start.toISOString(), end: end.toISOString() } ];
  }
  function seedDeals() {
    return [
      { id: uuid(), title: 'Acme Roofing', stage: 'lead', value: 12000 },
      { id: uuid(), title: 'Shingle Roof Saver', stage: 'qualified', value: 25000 },
      { id: uuid(), title: 'Rescue Roofer Retainer', stage: 'proposal', value: 8000 },
    ];
  }
  function seedDesks() {
    return Array.from({length: 72}, (_,i) => ({ id: i+1, label: `D${i+1}`, booked: Math.random() < 0.18, mine: i===7 }));
  }
  function seedReports(){
    const rand = () => Math.floor(20+Math.random()*80);
    return {
      velocity: Array.from({length: 8}, rand),
      utilization: Array.from({length: 8}, rand),
      inbox: Array.from({length: 8}, rand)
    };
  }

  let state = Object.assign({}, initialState, load() || {});

  // ---------- Theming & Density ----------
  function applyThemeFromState() {
    document.documentElement.dataset.density = state.ui.density;
    document.body.classList.toggle('wp-gradient', state.ui.wallpaper === 'gradient');
    document.body.classList.toggle('wp-dots', state.ui.wallpaper === 'dots');
    document.body.style.setProperty('--primary', state.ui.themePrimary);
    document.body.style.filter = state.ui.highContrast ? 'contrast(1.08) saturate(1.05)' : '';
    $('#roleSelect').value = state.ui.role;
    $('#orgSelect').value = state.ui.org;
    $('#presenceSelect').value = state.ui.presence;
    setPresenceDot(state.ui.presence);

    // Add these lines to create the new faded color
    const primaryColor = getComputedStyle(document.body).getPropertyValue('--primary').trim();
    const rgb = hexToRgb(primaryColor);
    if (rgb) {
      document.body.style.setProperty('--primary-faded', `rgba(${rgb.join(', ')}, 0.2)`);
    } else {
      document.body.style.setProperty('--primary-faded', `rgba(0, 0, 0, 0.2)`);
    }
    const userPrimary = state.user?.settings?.color;
    if (userPrimary) document.body.style.setProperty('--primary', userPrimary);
  }

  // ---- Backend helpers (add near other utilities) ----
  async function fetchJSON(url, opts={}) {
    const res = await fetch(url, { credentials: 'include', ...opts });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const msg = data?.error || data?.detail || `HTTP ${res.status}`;
      throw new Error(`${url}: ${msg}`);
    }
    return data || {};
  }

  async function hydrateFromBackend() {
    // 1) who am I (org-scoped)
    const me = await fetchJSON('/api/me');
    if (!me?.auth) throw new Error('Not authenticated');

    // keep your local UI role/org in sync with server
    state.ui.role = me.user.role || 'Member';
    state.ui.org  = me.org?.slug || state.ui.org || 'my-org';

    if (me?.org) {
      const orgSel = $('#orgSelect');
      if (orgSel) {
        orgSel.innerHTML = `<option value="${me.org.slug}">${me.org.name}</option>`;
        orgSel.value = me.org.slug;
      }
    }

    // 2) load org users if Admin/Manager (fallback to just "me" otherwise)
    let users = [];
    if (state.ui.role === 'Admin' || state.ui.role === 'Manager') {
      try {
        const d = await fetchJSON('/api/admin/users');
        if (Array.isArray(d.users)) users = d.users;
      } catch (_) { /* ignore; fallback below */ }
    }
    if (!users.length) {
      users = [{
        id: me.user.id,
        name: me.user.name || me.user.username || me.user.email,
        email: me.user.email,
        role: me.user.role,
        privileges: me.user.role === 'Admin' ? ['*'] : ['users.read'],
        createdAt: Date.now()
      }];
    }

    // normalize to the shape your table expects
    state.users = users.map(u => ({
      id: u.id,
      name: u.name || u.username || u.email,
      email: u.email || '',
      role: u.role || 'Member',
      privileges: Array.isArray(u.privileges) ? u.privileges
                  : (u.role === 'Admin' ? ['*'] : ['users.read']),
      createdAt: u.created_at ? (u.created_at*1000) : (u.createdAt || Date.now())
    }));

    save();
  }


    function setPresenceDot(v){
      const dot = $('#presenceDot');
      dot.style.background = ({available:'var(--success)', busy:'var(--warning)', away:'#888', dnd:'var(--danger)'}[v] || 'var(--success)');
    }

    // ---------- Router ----------
    const routes = $$('.route');
    function navigate(hash){
      const route = (hash || location.hash || '#/').replace('#','');
      $$('.nav-link').forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${route}`));
      routes.forEach(sec => sec.classList.toggle('active', sec.dataset.route === route));
      // focus main on navigation
      $('#main')?.focus({preventScroll:true});
      // close slideouts on route change
      hideSheet('notifPanel'); hideSheet('settingsPanel');
      // update per-route content
      renderRoute(route);
      save();
    }

  function renderRoute(route){
    if (route === '/') { renderHome(); }
    else if (route === '/inbox') { renderInbox(); }
    else if (route === '/chat') { renderChat(); }
    else if (route.startsWith('/workspace')) { renderWorkspace(route); }
    else if (route === '/calendar') { renderCalendar(); }
    else if (route === '/notes') { renderNotes(); }
    else if (route.startsWith('/clients')) { renderClients(route); }
    else if (route === '/twin') { renderTwin(); }
    else if (route === '/reports') { renderReports(); }
    else if (route === '/admin') { renderAdmin(); }
  }

  // ---------- Sidebar & Topbar ----------
  const appBody   = document.querySelector('.app-body');
  const sidebarEl = document.getElementById('sidebar');
  const btnSidebar = document.getElementById('btnSidebar');

  applySidebarState();

  function toggleSidebar(force){
    state.ui.sidebarOpen = (force ?? !state.ui.sidebarOpen);
    applySidebarState();
    save();
  }

  function applySidebarState(){
    const open = !!state.ui.sidebarOpen;

    // Desktop/tablet: collapse grid column when closed
    appBody && appBody.classList.toggle('sidebar-collapsed', !open);
    /* NEW: preserve icon-only class from user settings */
    appBody && appBody.classList.toggle(
      'sidebar-icon',
      (state.user?.settings?.sidebarMode || 'normal') === 'icon'
    );

   // Mobile: keep .open to slide in/out, and add a body overlay if desired
    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    if (isMobile){
      sidebarEl && sidebarEl.classList.toggle('open', open);
      document.body.classList.toggle('sidebar-open', open);
    }else{
      // ensure no leftover mobile classes on desktop
      sidebarEl && sidebarEl.classList.remove('open');
      document.body.classList.remove('sidebar-open');
    }

    // ARIA
    btnSidebar && btnSidebar.setAttribute('aria-expanded', open ? 'true' : 'false');
    sidebarEl && sidebarEl.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  // main toggle button
  on(btnSidebar, 'click', () => toggleSidebar());

  // close when clicking outside the sidebar (but not the toggle)
  on(document, 'click', (e) => {
    if (!state.ui.sidebarOpen) return;
  if (sidebarEl.contains(e.target) || btnSidebar.contains(e.target)) return;
    toggleSidebar(false);
  });

  // close when pressing Escape; Alt+S toggles
  on(document, 'keydown', (e) => {
    if (e.key === 'Escape' && state.ui.sidebarOpen) {
      e.preventDefault();
      toggleSidebar(false);
    }
    if ((e.altKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      toggleSidebar();
    }
  });

  // close the sidebar when clicking any nav link/button inside,
  // unless it has data-keep-open (for submenus etc.)
  on(sidebarEl, 'click', (e) => {
    const actionable = e.target.closest('a,button');
    if (!actionable) return;
    if (actionable.hasAttribute('data-keep-open')) return;
    toggleSidebar(false);
  });

  on($('#btnNew'), 'click', (e) => {
    const menu = $('#newMenu');
    menu.hidden = !menu.hidden;
    positionMenu(e.currentTarget, menu);
  });
  on(document, 'click', (e) => {
    const menu = $('#newMenu');
    if (!menu.hidden && !menu.contains(e.target) && e.target !== $('#btnNew')) menu.hidden = true;
  });
  $$('#newMenu [role="menuitem"]').forEach(btn => on(btn, 'click', (e) => {
    toast(`New → ${(e.currentTarget.dataset.action||'item').replace(/new/i,'')}`);
    $('#newMenu').hidden = true;
  }));

  function positionMenu(anchor, menu){
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6 + window.scrollY}px`;
    menu.style.left = `${rect.left + rect.width/2 - menu.offsetWidth/2 + window.scrollX}px`;
  }

  // ---------- Role‑aware nav ----------
  function applyRoleVisibility(){
    const role = state.ui.role;
    $$('.nav-link').forEach(a => {
      const roles = (a.dataset.roles || '').split(',').map(s => s.trim());
      a.parentElement.style.display = roles.length && roles[0] !== '' && !roles.includes(role) ? 'none' : '';
    });
  }

  on($('#roleSelect'), 'change', (e) => {
    state.ui.role = e.target.value; applyRoleVisibility(); save();
  });

  // ---------- Presence ----------
  on($('#presenceSelect'), 'change', (e) => {
    state.ui.presence = e.target.value; setPresenceDot(state.ui.presence); save();
  });

  // ---------- Search ----------
  const searchInput = $('#globalSearch');
  const searchResults = $('#searchResults');
  on(searchInput, 'input', () => runSearch(searchInput.value.trim()));
  on(searchInput, 'keydown', (e) => {
    const items = $$('.res', searchResults);
    const current = items.findIndex(li => li.getAttribute('aria-selected')==='true');
    if (e.key === 'ArrowDown') { e.preventDefault(); const i = clamp(current+1, 0, items.length-1); selectRes(items, i); }
    if (e.key === 'ArrowUp') { e.preventDefault(); const i = clamp(current-1, 0, items.length-1); selectRes(items, i); }
    if (e.key === 'Enter') { const i = current < 0 ? 0 : current; items[i]?.click(); }
    if (e.key === 'Escape') { searchResults.hidden = true; }
  });
  function runSearch(q){
    if (!q) { searchResults.hidden = true; searchResults.innerHTML = ''; return; }
    const pool = [
      ...state.tasks.map(t => ({type:'Task', label:t.title, link:'#/workspace/my-tasks'})),
      ...state.calendar.events.map(e => ({type:'Event', label:e.title, link:'#/calendar'})),
      ...state.notes.map(n => ({type:'Note', label:n.title, link:'#/notes'})),
      ...state.projects.map(p => ({type:'Project', label:p.name, link:'#/workspace/projects'})),
      ...state.inbox.items.map(m => ({type:'Message', label:m.subject, link:'#/inbox'})),
    ];
    const res = pool.filter(x => x.label?.toLowerCase().includes(q.toLowerCase())).slice(0,12);
    searchResults.innerHTML = res.map((r,i)=>`<div class="res" role="option" aria-selected="${i===0}"><div><div><strong>${r.type}</strong></div><div>${hl(r.label,q)}</div></div><span>↪</span></div>`).join('');
    searchResults.hidden = res.length===0;
    $$('.res', searchResults).forEach((el,i)=> on(el,'click',()=>{ location.hash = r(res,i).link; searchResults.hidden = true; }));
  }
  const r = (arr,i)=>arr[i];
  const hl = (txt,q) => txt.replace(new RegExp(`(${escapeReg(q)})`,'ig'),'<mark>$1</mark>');
  const escapeReg = (s)=> s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

  // keyboard focus to search with '/'
  on(window, 'keydown', (e)=>{ if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); searchInput.focus(); } });

  // ---------- Command Palette (⌘K) ----------
  const cmdk = $('#cmdk');
  const cmdkInput = $('#cmdkInput');
  const cmdkList = $('#cmdkList');
  const openCmdK = ()=>{ cmdk.showModal(); cmdkInput.value=''; renderCmdList(''); cmdkInput.focus(); };
  const closeCmdK = ()=>{ cmdk.close(); };
  on($('#cmdkBtn'), 'click', openCmdK);
  on(window, 'keydown', (e)=>{
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); openCmdK(); }
  });
  on(cmdk, 'close', ()=> cmdkInput.value='');
  on(cmdkInput,'input',()=>renderCmdList(cmdkInput.value));
  on(cmdkList, 'click', (e)=>{
    const li = e.target.closest('li'); if (!li) return; runCommand(li.dataset.cmd); closeCmdK();
  });

  const commands = [
    { id:'go:home', label:'Go → Home', run: ()=> location.hash = '#/' },
    { id:'go:inbox', label:'Go → Inbox', run: ()=> location.hash = '#/inbox' },
    { id:'go:chat', label:'Go → Chat', run: ()=> location.hash = '#/chat' },
    { id:'new:task', label:'New → Task', run: ()=> quickNewTask() },
    { id:'assist:summary', label:'Assistant → Summarize my day', run: ()=> assistSummary() },
    { id:'toggle:sidebar', label:'Toggle sidebar', run: ()=> toggleSidebar() },
    { id:'open:settings', label:'Open settings', run: ()=> showSheet('settingsPanel') },
  ];
  function renderCmdList(q){
    const list = commands.filter(c => c.label.toLowerCase().includes(q.toLowerCase()));
    cmdkList.innerHTML = list.map(c=>`<li data-cmd="${c.id}" role="option">${c.label}</li>`).join('');
  }
  function runCommand(id){
    const c = commands.find(x=>x.id===id); c?.run?.();
  }

  // ---------- Notifications Panel ----------
  on($('#btnNotifications'), 'click', ()=> showSheet('notifPanel'));
  on($('#btnCloseNotif'), 'click', ()=> hideSheet('notifPanel'));
  function showSheet(id){
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = false;
    if (id === 'settingsPanel') initUserSettings();
  }
  function hideSheet(id){ const el = document.getElementById(id); if (el) el.hidden = true; }

  function pushNotif({type='info', title='Notification', body='', priority=false}){
    const n = { id: uuid(), ts: Date.now(), type, title, body, read:false, priority };
    state.notifications.unshift(n); save(); renderNotifs();
    if (priority) playSound('priority'); else playSound('default');
  }
  function renderNotifs(){
    $('#notifCount').textContent = String(state.notifications.filter(n=>!n.read).length);
    const groups = $('#notifGroups');
    if (!state.notifications.length) { groups.textContent = 'No notifications'; return; }
    groups.innerHTML = state.notifications.slice(0,30).map(n=>`
      <div class="item" style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <strong>${n.title}</strong>
          <small>${new Date(n.ts).toLocaleTimeString()}</small>
        </div>
        <div class="muted">${n.body}</div>
        <div class="btn-row" style="margin-top:6px">
          <button class="btn sm" data-mark="${n.id}">${n.read?'Mark unread':'Mark read'}</button>
          <button class="btn sm" data-del="${n.id}">Dismiss</button>
        </div>
      </div>`).join('');
    $$('#notifGroups [data-mark]').forEach(b=> on(b,'click',()=>{ const n = state.notifications.find(x=>x.id===b.dataset.mark); if (n){ n.read = !n.read; save(); renderNotifs(); }}));
    $$('#notifGroups [data-del]').forEach(b=> on(b,'click',()=>{ state.notifications = state.notifications.filter(x=>x.id!==b.dataset.del); save(); renderNotifs(); }));
  }

  // ---------- Toasts ----------
  function toast(msg, tone='info'){ const t = document.createElement('div'); t.className='toast'; t.innerHTML = msg; $('#toasts').appendChild(t); setTimeout(()=> t.remove(), 3200); }

  // ---------- Home Dashboard ----------
  function renderHome(){
    // My Tasks
    const my = $('#homeMyTasks'); my.innerHTML = state.tasks.slice(0,5).map(t=>`<li class="item">${t.title}<span class="meta">Due ${fmtDate(t.due)}</span></li>`).join('') || '<li class="muted">No tasks</li>';
    // Calendar
    $('#homeEvents').innerHTML = state.calendar.events.slice(0,5).map(e=>`<li class="item">${e.title}<span class="meta">${fmt(e.start)}</span></li>`).join('') || '<li class="muted">No events</li>';
    // Inbox
    if (!state.inbox.items.length) seedInbox();
    $('#homeInbox').innerHTML = state.inbox.items.slice(0,5).map(m=>`<li class="item">${m.subject}<span class="meta">${m.from} • ${fmt(m.ts)}</span></li>`).join('');
    // KPIs
    $('#kpiRevenue').textContent = `$${(123000 + Math.floor(Math.random()*4000)).toLocaleString()}`;
    $('#kpiUtilization').textContent = `${60+Math.floor(Math.random()*20)}%`;
    $('#kpiCSAT').textContent = `${92+Math.floor(Math.random()*6)}%`;
    $('#kpiCycle').textContent = `${2+Math.floor(Math.random()*4)}d`;
  }

  function seedInbox(){
    state.inbox.items = Array.from({length: 18}, (_,i)=>({
      id: uuid(), from: ['Jasmine','Client Portal','Stripe','GitHub','Google Calendar'][i%5],
      subject: ['New lead inquiry','Invoice paid','PR review needed','Meeting invite','Nudge: overdue task'][i%5]+` #${i+1}`,
      body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus vel.',
      unread: Math.random() < .4,
      ts: Date.now() - i*3600_000
    }));
  }

  // ---------- Inbox ----------
  function renderInbox(){
    const list = $('#inboxList');
    const filter = state.inbox.filter;
    const items = state.inbox.items.filter(m => filter==='all' || (filter==='unread'? m.unread : true));
    list.innerHTML = items.map(m=>`<div class="inbox-item" data-id="${m.id}">
      <div style="width:10px"><span class="badge" style="visibility:${m.unread?'visible':'hidden'}">•</span></div>
      <div style="flex:1">
        <div><strong>${m.subject}</strong></div>
        <div class="meta">${m.from} • ${fmt(m.ts)}</div>
        <div class="meta">${m.body}</div>
      </div>
    </div>`).join('');
    $$('#inboxList .inbox-item').forEach(el=> on(el,'click',()=> openThread(el.dataset.id)));

    // filters
    $$('#inbox [data-filter]').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.filter === filter);
      chip.onclick = ()=>{ state.inbox.filter = chip.dataset.filter; save(); renderInbox(); };
    });

    // Smart Views (mock)
    const sv = $('#smartViews');
    sv.innerHTML = ['Today','Mentioned','Action Needed','Clients','Billing'].map(tag=>`<li class="item">${tag}</li>`).join('');

    // Context panel toggle demo
    const ctx = $('#contextPanel'); const close = $('#btnCloseContext');
    on(close,'click',()=> ctx.hidden = true);
  }
  function openThread(id){
    const m = state.inbox.items.find(x=>x.id===id); if (!m) return;
    m.unread = false; save(); renderNotifs();
    const tv = $('#threadView'); tv.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;justify-content:space-between">
        <h3 style="margin:0">${m.subject}</h3>
        <div class="btn-row">
          <button class="btn sm" id="btnThreadDetail">Details</button>
          <button class="btn sm" id="btnReply">Reply</button>
        </div>
      </div>
      <div class="message" style="margin-top:10px">
        <div style="font-weight:600">${m.from}</div>
        <div>${m.body} ${m.body}</div>
      </div>
      <div class="composer" style="margin-top:8px">
        <textarea id="replyBox" placeholder="Write a reply…"></textarea>
        <button class="btn primary" id="sendReply">Send</button>
      </div>`;
    on($('#btnThreadDetail'),'click',()=>{
      const ctx = $('#contextPanel'); ctx.hidden = false; $('#contextContent').innerHTML = `<div class="list"><div class="item"><strong>From</strong>: ${m.from}</div><div class="item"><strong>Received</strong>: ${fmt(m.ts)}</div></div>`;
    });
    on($('#sendReply'),'click',()=>{ toast('Reply sent'); playSound('dm'); });
  }

  // ---------- Chat ----------
  function renderChat(){
    if (!state.chat.channels.length) seedChat();
    const list = $('#chatList');
    list.innerHTML = state.chat.channels.map(c=>`<li class="item" data-id="${c.id}" ${c.id===state.chat.activeId?'aria-selected="true"':''}>#${c.name}</li>`).join('');
    $$('#chatList .item').forEach(li => on(li,'click',()=>{ state.chat.activeId = li.dataset.id; save(); renderChat(); }));
    renderChatMessages();
    on($('#chatAttach'),'click',()=> $('#chatFile').click());
    on($('#chatSend'),'click',sendChat);
  }
  function seedChat(){
    const g = (name)=>({ id: uuid(), name, members:['you','team'], messages:[ {id:uuid(), author:'system', text:`Welcome to #${name}`, ts:Date.now()-3600_000} ]});
    state.chat.channels = [g('general'), g('sales'), g('dev')];
    state.chat.activeId = state.chat.channels[0].id;
  }
  function renderChatMessages(){
    const ch = state.chat.channels.find(c=>c.id===state.chat.activeId); if (!ch) return;
    const box = $('#chatMessages');
    box.innerHTML = ch.messages.slice(-200).map(m=>`<div class="message ${m.author==='you'?'me':''}"><div style="font-weight:600">${m.author}</div><div>${m.text}</div><div class="meta">${fmt(m.ts)}</div></div>`).join('');
    box.scrollTop = box.scrollHeight;
  }
  function sendChat(){
    const input = $('#chatInput'); const txt = input.value.trim(); if (!txt) return;
    const ch = state.chat.channels.find(c=>c.id===state.chat.activeId); if (!ch) return;
    ch.messages.push({ id: uuid(), author:'you', text: txt, ts: Date.now() });
    input.value = ''; save(); renderChatMessages();
    if (Math.random()<0.5) setTimeout(()=>{ ch.messages.push({ id: uuid(), author:'bot', text: 'Noted 👍', ts: Date.now() }); save(); renderChatMessages(); }, 600);
  }

  // ---------- Workspace ----------
  function renderWorkspace(route){
    if (route==='/workspace/projects') renderProjects();
    if (route==='/workspace/my-tasks') renderMyTasks();
    if (route==='/workspace/boards') renderBoards();
    if (route==='/workspace/time') renderTime();
    if (route==='/workspace/automations') renderAutomations();
    if (route==='/workspace/files') {/* placeholder */}
  }

  // Projects
  on($('#btnNewProject'),'click',()=>{
    const name = prompt('Project name?'); if (!name) return;
    state.projects.push({ id: uuid(), name, desc:'', created: Date.now() });
    save(); renderProjects(); toast('Project created');
  });
  function renderProjects(){
    const grid = $('#projectsGrid');
    const q = ($('#projectSearch')?.value||'').toLowerCase();
    const list = state.projects.filter(p=>p.name.toLowerCase().includes(q));
    grid.innerHTML = list.map(p=> `<article class="card"><header><h3>${p.name}</h3></header><div class="muted">Created ${fmt(p.created)}</div></article>`).join('') || '<div class="muted">No projects yet.</div>';
  }
  on($('#projectSearch'),'input', renderProjects);

  // My Tasks (buckets + drag)
  function renderMyTasks(){
    ['bucketToday','bucketNext','bucketLater'].forEach(id=> $(`#${id}`).innerHTML='');
    state.tasks.forEach(t => appendTaskEl(t));
  }
  function appendTaskEl(t){
    const ul = t.bucket==='today'? $('#bucketToday') : t.bucket==='next' ? $('#bucketNext') : $('#bucketLater');
    const li = document.createElement('li'); li.className='task'; li.draggable = true; li.dataset.id = t.id;
    li.innerHTML = `<input type="checkbox" ${t.status==='done'?'checked':''} aria-label="Complete"> <span contenteditable="true" spellcheck="false">${t.title}</span> <span class="meta">${fmtDate(t.due)}</span>`;
    on(li,'dragstart',()=>{ li.classList.add('dragging'); });
    on(li,'dragend',()=>{ li.classList.remove('dragging'); save(); });
    $$('[data-bucket]').forEach(b => {
      on(b,'dragover',(e)=>{
        e.preventDefault();
        const dragging = $('.task.dragging');
        if (!dragging) return; b.querySelector('.task-list').appendChild(dragging);
        const task = state.tasks.find(x=>x.id===dragging.dataset.id); task.bucket = b.dataset.bucket;
      });
    });
    const cb = $('input[type="checkbox"]', li);
    on(cb,'change',()=>{ t.status = cb.checked?'done':'todo'; save(); });
    const title = $('span[contenteditable]', li);
    on(title,'blur',()=>{ t.title = title.textContent.trim(); save(); });
    ul.appendChild(li);
  }
  function quickNewTask(){
    const t = { id: uuid(), title: 'Untitled Task', bucket: 'today', status: 'todo', due: addDaysStr(0), assignee:'me' };
    state.tasks.unshift(t); save(); renderMyTasks(); toast('Task created');
  }

  // Boards (task status kanban)
  function renderBoards(){
    const cols = { todo: $('#kanTodo'), doing: $('#kanDoing'), done: $('#kanDone') };
    Object.values(cols).forEach(c=> c.innerHTML='');
    state.tasks.forEach(t=>{
      const el = document.createElement('div'); el.className='task'; el.draggable=true; el.dataset.id=t.id; el.innerHTML = `${t.title}`;
      on(el,'dragstart',()=> el.classList.add('dragging'));
      on(el,'dragend',()=>{ el.classList.remove('dragging'); save(); });
      cols[t.status].appendChild(el);
    });
    $$('.kan-col').forEach(col=> on(col,'dragover',(e)=>{
      e.preventDefault();
      const dragging = $('.task.dragging'); if (!dragging) return;
      col.querySelector('.kan-items').appendChild(dragging);
      const task = state.tasks.find(x=>x.id===dragging.dataset.id); task.status = col.dataset.status; save();
    }));
  }

  // Time Tracking
  function renderTime(){
    const sel = $('#timerTask'); sel.innerHTML = state.tasks.map(t=>`<option value="${t.id}">${t.title}</option>`).join('');
    $('#btnTimerStart').disabled = !!state.time.startTs;
    $('#btnTimerStop').disabled = !state.time.startTs;
    $('#timerDisplay').textContent = formatElapsed();
    const tbody = $('#timeEntries tbody');
    tbody.innerHTML = state.time.entries.map(e=>`<tr><td>${taskTitle(e.taskId)}</td><td>${fmt(e.start)}</td><td>${fmt(e.end)}</td><td>${formatDuration(e.end-e.start)}</td><td>${e.billable?'Yes':'No'}</td><td>${e.memo||''}</td></tr>`).join('');
  }
  function taskTitle(id){ return state.tasks.find(t=>t.id===id)?.title || '—'; }
  function formatDuration(ms){ const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; }
  function formatElapsed(){ if(!state.time.startTs) return '00:00:00'; return formatDuration(Date.now()-state.time.startTs); }
  let tick;
  on($('#btnTimerStart'),'click',()=>{
    const id = $('#timerTask').value; state.time.runningTaskId = id; state.time.startTs = Date.now(); save(); renderTime(); tick = setInterval(()=> $('#timerDisplay').textContent = formatElapsed(), 1000);
  });
  on($('#btnTimerStop'),'click',()=>{
    if (!state.time.startTs) return; const end = Date.now(); clearInterval(tick);
    state.time.entries.unshift({ id: uuid(), taskId: state.time.runningTaskId, start: state.time.startTs, end, billable: true, memo:'' });
    state.time.startTs = null; state.time.runningTaskId = null; save(); renderTime();
  });
  on($('#btnExportCSV'),'click',()=>{
    const rows = [['Task','Started','Ended','Duration','Billable','Memo'], ...state.time.entries.map(e=>[taskTitle(e.taskId), fmt(e.start), fmt(e.end), formatDuration(e.end-e.start), e.billable, (e.memo||'')])];
    const csv = rows.map(r=> r.map(x=>`"${String(x).replaceAll('"','""')}"`).join(',')).join('\n');
    download('time-entries.csv', csv, 'text/csv');
  });

  // Automations (Rules + Dry Run)
  function renderAutomations(){
    const list = $('#rulesList'); list.innerHTML = state.rules.map(r=>`<li class="item">${r.trigger} → ${r.actions.length} action(s)</li>`).join('') || '<li class="muted">No rules yet</li>';
  }
  on($('#btnNewRule'),'click',()=>{
    const trigger = $('#ruleTrigger').value;
    const conditions = tryParse($('#ruleConditions').value) || {};
    const actions = tryParse($('#ruleActions').value) || [];
    const enabled = $('#ruleEnabled').checked;
    state.rules.push({ id: uuid(), trigger, conditions, actions, enabled }); save(); renderAutomations(); toast('Rule saved');
  });
  on($('#btnSaveRule'),'click',(e)=>{ e.preventDefault(); $('#btnNewRule').click(); });
  on($('#btnTestRule'),'click',(e)=>{ e.preventDefault(); const out=$('#ruleOutput'); out.textContent='Running dry run...'; setTimeout(()=> out.textContent = JSON.stringify({matched:true, actions:[{type:'notify',users:['@team'],message:'New item'}]}, null, 2), 300); });
  function tryParse(v){ try { return JSON.parse(v); } catch { return null; } }

  // Calendar
  function renderCalendar(view){
    const wrap = $('#calendar');
    const mode = view || wrap.dataset.view || 'month';
    wrap.dataset.view = mode;
    const now = new Date();
    const start = new Date(now); start.setDate(1);
    const end = new Date(now.getFullYear(), now.getMonth()+1, 0);

    if (mode==='month'){
      wrap.innerHTML = `<div class="cal-grid cal-month">${Array.from({length: end.getDate()}, (_,i)=>{
        const day = new Date(now.getFullYear(), now.getMonth(), i+1);
        const events = state.calendar.events.filter(e=> new Date(e.start).toDateString() === day.toDateString());
        return `<div class="cal-cell"><div class="meta">${i+1}</div>${events.map(ev=>`<a href="#" class="event" data-id="${ev.id}">${ev.title}</a>`).join('')}</div>`;
      }).join('')}</div>`;
    } else if (mode==='week' || mode==='day') {
      const days = mode==='day'?1:7;
      wrap.innerHTML = `<div class="cal-grid ${mode==='day'?'cal-day':'cal-week'}">${Array.from({length: days}, (_,i)=>{
        const day = new Date(now); day.setDate(now.getDate() - now.getDay() + i);
        const events = state.calendar.events.filter(e=> sameDay(new Date(e.start), day));
        return `<div class="cal-cell"><div class="meta">${day.toDateString()}</div>${events.map(ev=>`<a href="#" class="event" data-id="${ev.id}">${ev.title}</a>`).join('')}</div>`;
      }).join('')}</div>`;
    }
    $$('#calendar .event').forEach(a=> on(a,'click',(e)=>{ e.preventDefault(); const ev = state.calendar.events.find(x=>x.id===a.dataset.id); toast(`${ev.title}: ${fmt(ev.start)} → ${fmt(ev.end)}`); }));
  }
  function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
  $$('[data-calview]').forEach(btn=> on(btn,'click',()=> renderCalendar(btn.dataset.calview)));
  on($('#btnNewEvent'),'click',()=>{
    const title = prompt('Event title?'); if (!title) return;
    const start = prompt('Start (YYYY-MM-DD HH:MM)', new Date().toISOString().slice(0,16).replace('T',' ')); if (!start) return;
    const end = prompt('End (YYYY-MM-DD HH:MM)', new Date(Date.now()+3600000).toISOString().slice(0,16).replace('T',' '));
    state.calendar.events.push({ id: uuid(), title, start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    save(); renderCalendar(); toast('Event created');
  });

  // Notes
  function renderNotes(){
    const list = $('#notesList'); list.innerHTML = state.notes.map(n=>`<li class="item" data-id="${n.id}">${n.title||'(untitled)'} <span class="meta">${fmt(n.updated)}</span></li>`).join('');
    $$('#notesList .item').forEach(li => on(li,'click',()=> openNote(li.dataset.id)));
  }
  on($('#btnNewNote'),'click',()=>{ const n={id:uuid(), title:'New Note', body:'', updated: Date.now(), tags:[]}; state.notes.unshift(n); save(); renderNotes(); openNote(n.id); });
  function openNote(id){
    const n = state.notes.find(x=>x.id===id); if (!n) return;
    $('#noteTitle').value = n.title; $('#noteEditor').innerHTML = n.body; $('#noteMeta').textContent = `Updated ${fmt(n.updated)} • Tags: ${(n.tags||[]).join(', ')||'—'}`;
    on($('#btnSaveNote'),'click',()=>{ n.title = $('#noteTitle').value.trim(); n.body = $('#noteEditor').innerHTML; n.updated = Date.now(); save(); renderNotes(); toast('Note saved'); });
    on($('#btnExtractTasks'),'click',()=>{
      const found = (n.body.match(/\n?- \[( |x)\] .+/g)||[]).map(s=> s.replace(/^\n?- \[( |x)\] /,''));
      found.forEach(t=> state.tasks.unshift({ id: uuid(), title: t, bucket:'next', status:'todo', due:addDaysStr(1), assignee:'me' }));
      save(); toast(`${found.length} task(s) extracted`); renderMyTasks();
    });
    on($('#btnTagNote'),'click',()=>{ const tag = prompt('Add tag'); if (!tag) return; n.tags = Array.from(new Set([...(n.tags||[]), tag])); save(); openNote(id); });
  }

  // Clients: CRM / Brand DNA / Billing / Sequences
  function renderClients(route){
    if (route==='/clients/crm') renderCRM();
    if (route==='/clients/brand-dna') renderDNA();
    if (route==='/clients/billing') renderBilling();
    if (route==='/clients/sequences') renderSequences();
  }
  function renderCRM(){
    const cols = { lead: $('#crmLead'), qualified: $('#crmQualified'), proposal: $('#crmProposal'), won: $('#crmWon'), lost: $('#crmLost') };
    Object.values(cols).forEach(c=> c.innerHTML='');
    state.crm.deals.forEach(d=>{
      const el = document.createElement('div'); el.className='deal-card'; el.draggable=true; el.dataset.id=d.id; el.innerHTML = `<strong>${d.title}</strong><div class="meta">$${d.value.toLocaleString()}</div>`;
      on(el,'dragstart',()=> el.classList.add('dragging'));
      on(el,'dragend',()=>{ el.classList.remove('dragging'); save(); });
      cols[d.stage].appendChild(el);
    });
    $$('.kanban.crm .kan-col').forEach(col=> on(col,'dragover',(e)=>{
      e.preventDefault(); const dragging=$('.deal-card.dragging'); if (!dragging) return;
      col.querySelector('.kan-items').appendChild(dragging);
      const deal = state.crm.deals.find(x=>x.id===dragging.dataset.id); deal.stage = col.dataset.stage; save();
    }));
    on($('#btnNewDeal'),'click',()=>{ const t=prompt('Deal title?'); if(!t) return; state.crm.deals.unshift({id:uuid(), title:t, stage:'lead', value: Math.floor(5000+Math.random()*20000)}); save(); renderCRM(); });
  }
  function renderDNA(){
    $('#dnaMission').value = state.dna.mission;
    $('#dnaFormal').value = state.dna.formal;
    $('#dnaPlayful').value = state.dna.playful;
    $('#dnaEnth').value = state.dna.enth;
    $('#dnaBanned').value = state.dna.banned;
    on($('#btnSaveDNA'),'click',(e)=>{ e.preventDefault(); state.dna = { mission:$('#dnaMission').value, formal:+$('#dnaFormal').value, playful:+$('#dnaPlayful').value, enth:+$('#dnaEnth').value, banned:$('#dnaBanned').value }; save(); toast('Brand DNA saved'); });
    on($('#btnApplyDNA'),'click',()=>{
      const txt = $('#dnaSample').value || 'We love helping homeowners!';
      const banned = (state.dna.banned||'').split(',').map(s=>s.trim()).filter(Boolean);
      let out = txt;
      banned.forEach(bw => out = out.replace(new RegExp(escapeReg(bw),'ig'), '—'));
      $('#dnaOut').textContent = out + `\n\n[Tone] Formal:${state.dna.formal} Playful:${state.dna.playful} Enth:${state.dna.enth}`;
    });
  }
  function renderBilling(){
    const invT = $('#invoiceTable tbody'); const subT = $('#subsTable tbody');
    if (!state.billing.invoices.length){ state.billing.invoices = [ {id:1001, client:'Acme', amount:1200, status:'Paid', due:addDaysStr(0)}, {id:1002, client:'SR Saver', amount:800, status:'Open', due:addDaysStr(7)} ]; }
    if (!state.billing.subs.length){ state.billing.subs = [ {client:'Rescue Roofer', plan:'Pro', status:'Active', started:addDaysStr(-30), cancel:null} ]; }
    invT.innerHTML = state.billing.invoices.map(i=>`<tr><td>${i.id}</td><td>${i.client}</td><td>$${i.amount.toLocaleString()}</td><td>${i.status}</td><td>${fmtDate(i.due)}</td></tr>`).join('');
    subT.innerHTML = state.billing.subs.map(s=>`<tr><td>${s.client}</td><td>${s.plan}</td><td>${s.status}</td><td>${fmtDate(s.started)}</td><td>${s.cancel?fmtDate(s.cancel):'—'}</td></tr>`).join('');
  }
  function renderSequences(){
    const list = $('#seqList'); list.innerHTML = state.sequences.map(s=>`<li class="item">${s.name} • ${s.steps.length} step(s)</li>`).join('') || '<li class="muted">No sequences</li>';
    on($('#btnNewSequence'),'click',()=>{
      const name = $('#seqName').value || 'Untitled'; const steps = tryParse($('#seqSteps').value) || []; state.sequences.push({ id: uuid(), name, steps }); save(); renderSequences(); toast('Sequence saved');
    });
    on($('#btnSaveSequence'),'click',(e)=>{ e.preventDefault(); $('#btnNewSequence').click(); });
    on($('#btnTestSequence'),'click',(e)=>{ e.preventDefault(); $('#seqOut').textContent = JSON.stringify({scheduled: true, at:'T+0m, T+1d'}, null, 2); });
  }

  // Digital Twin (Desk booking)
  function renderTwin(){
    const grid = $('#deskGrid'); grid.style.setProperty('--cols', state.twin.cols);
    grid.innerHTML = state.twin.desks.map(d=>`<button class="desk ${d.booked?'booked':''} ${d.mine?'mine':''}" data-id="${d.id}">${d.label}</button>`).join('');
    $$('#deskGrid .desk').forEach(btn => on(btn,'click',()=>{
      const d = state.twin.desks.find(x=>x.id==btn.dataset.id);
      if (d.booked && !d.mine) { toast('Desk already booked', 'warn'); return; }
      d.mine = !d.mine; d.booked = d.mine; save(); renderTwin();
    }));
  }

  // Reports (simple bar charts with div heights)
  function renderReports(){
    const v = $('#repVelocity'); const u = $('#repUtilization'); const i = $('#repInbox');
    const make = (el, arr)=> el.innerHTML = arr.map(x=>`<div class="bar" style="height:${x}%" title="${x}"></div>`).join('');
    make(v, state.reports.velocity); make(u, state.reports.utilization); make(i, state.reports.inbox);
  }

  // Admin / Theme
  function renderAdmin(){
    $('#themePrimary').value = state.ui.themePrimary;
    $('#wallpaperSelect').value = state.ui.wallpaper;
    $('#densitySelect').value = state.ui.density;
    $('#highContrast').checked = !!state.ui.highContrast;
    on($('#btnSaveTheme'),'click',(e)=>{
      e.preventDefault();
      state.ui.themePrimary = $('#themePrimary').value;
      state.ui.wallpaper = $('#wallpaperSelect').value;
      state.ui.density = $('#densitySelect').value;
      state.ui.highContrast = $('#highContrast').checked;
      applyThemeFromState(); save(); toast('Theme updated');
      renderAdminUsers(); // attach Users
    });
    // Sounds demo
    $$('[data-sound]').forEach(b => on(b,'click',()=> playSound(b.dataset.sound)));
  }

  // ========== User Settings (everyone) ==========
  function initUserSettings() {
  state.user = state.user || {};
  state.user.settings = state.user.settings || {
    density: 'comfortable',
    font: 'system-ui',
    theme: 'light',
    color: '#6c7fff',
    language: 'en',
    region: 'auto',
    sidebarMode: 'normal',   // new in 1.6.0
    timezone: guessTimezone(),
    sounds: { notification: '', ringing: '' },
    profile: { name: '', email: '', bio: '', avatar: '' }
  };
  save();

  // Populate timezone list
  const tzSel = $('#setTimezone');
  if (tzSel && !tzSel.options.length) {
    getAllTimezones().forEach(tz => {
      const opt = document.createElement('option');
      opt.value = tz; opt.textContent = tz;
      tzSel.appendChild(opt);
    });
  }

  // Bind UI controls (only once)
  const card = $('#userSettingsCard');
  if (!card || card.dataset.bound) { applyUserSettings(); return; }

  // Prefill controls
  const s = state.user.settings;
  setVal('#setDensity', s.density);
  setVal('#setFont', s.font);
  setVal('#setTheme', s.theme);
  setVal('#setColor', s.color);
  setVal('#setLanguage', s.language);
  setVal('#setRegion', s.region);
  setVal('#setTimezone', s.timezone);
  setVal('#setProfileName', s.profile.name);
  setVal('#setProfileEmail', s.profile.email);
  setVal('#setProfileBio', s.profile.bio);
  setVal('#setSidebarMode', s.sidebarMode || 'normal');
  if (s.profile.avatar) $('#avatarPreviewImg').src = s.profile.avatar;

  on($('#setSidebarMode'), 'change', () => {
    state.user.settings.sidebarMode = $('#setSidebarMode').value;
    save();
    applyUserSettings();
  });

  // File inputs
  on($('#setToneNotification'), 'change', (e) => loadAudioAsDataURL(e.target.files[0], 'notification'));
  on($('#setToneRinging'), 'change', (e) => loadAudioAsDataURL(e.target.files[0], 'ringing'));
  on($('#setProfileAvatar'), 'change', (e) => loadImageAsDataURL(e.target.files[0]));

  // Preview buttons
  on($('#btnPreviewNotification'), 'click', () => previewTone('notification'));
  on($('#btnPreviewRinging'), 'click', () => previewTone('ringing'));

  // Save / Reset
  on($('#btnSaveUserSettings'), 'click', () => {
    const ns = collectSettings();
    state.user.settings = ns;
    save();
    applyUserSettings();
    toast('Settings saved');
  });
  on($('#btnResetUserSettings'), 'click', () => {
    if (!confirm('Reset your personal settings to defaults?')) return;
    delete state.user.settings;
    initUserSettings();     // re-init to defaults
    applyUserSettings();
    toast('Settings reset');
  });

  // Live apply on change (optional, feels instant)
  ['#setDensity','#setFont','#setTheme','#setColor'].forEach(sel => {
    on($(sel), 'change', () => { 
      const ns = collectSettings(); 
      state.user.settings = ns; save(); applyUserSettings(); 
    });
  });

  card.dataset.bound = '1';
  applyUserSettings();

  // ----- helpers -----
  function collectSettings() {
    return {
      density: val('#setDensity','comfortable'),
      font: val('#setFont','system-ui'),
      theme: val('#setTheme','system'),
      color: val('#setColor','#6c7fff'),
      language: val('#setLanguage','en'),
      region: val('#setRegion','auto'),
      timezone: val('#setTimezone', guessTimezone()),
      sounds: {
        notification: s.sounds.notification, // preserved unless file chosen
        ringing: s.sounds.ringing
      },
      profile: {
        name: val('#setProfileName',''),
        email: val('#setProfileEmail',''),
        bio: val('#setProfileBio',''),
        avatar: s.profile.avatar
      }
    };
  }

  function loadAudioAsDataURL(file, key) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.user.settings.sounds[key] = reader.result || '';
      save();
      toast(`${key === 'notification' ? 'Notification' : 'Ringing'} tone loaded`);
    };
    reader.readAsDataURL(file);
  }

  function loadImageAsDataURL(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.user.settings.profile.avatar = reader.result || '';
      save();
      $('#avatarPreviewImg').src = state.user.settings.profile.avatar;
      toast('Avatar updated');
    };
    reader.readAsDataURL(file);
  }

  function previewTone(key) {
    const url = (state.user.settings.sounds[key] || '').trim();
    if (!url) { toast('No tone uploaded'); return; }
    const a = $('#audioPreview');
    a.src = url; a.currentTime = 0; a.play().catch(()=>{});
  }

  function val(sel, fallback='') {
    const el = $(sel);
    return el ? (el.value || fallback) : fallback;
  }
  function setVal(sel, v) {
    const el = $(sel); if (el) el.value = v;
  }
}

function applyUserSettings() {
  const s = state.user?.settings; if (!s) return;

  // Density → attribute that CSS already uses
  const html = document.documentElement;
  const d = (s.density === 'cozy') ? 'cozy' : (s.density || 'comfortable');
  html.setAttribute('data-density', d);

  // Font → apply directly so you see it immediately
  document.body.style.fontFamily = s.font || 'system-ui';

  // Theme mode → attribute (light/dark/system)
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const mode = (s.theme === 'system') ? (prefersDark ? 'dark' : 'light') : s.theme;
  html.setAttribute('data-theme', mode);

  // Primary color → CSS variable
  const color = s.color || '#6c7fff';
  document.body.style.setProperty('--primary', color);

  // Keep --primary-faded in sync (used for subtle backgrounds)
  const rgb = (typeof hexToRgb === 'function') ? hexToRgb(color) : null;
  document.body.style.setProperty('--primary-faded', rgb ? `rgba(${rgb.join(', ')}, 0.2)` : 'rgba(0,0,0,.2)');
}

// Utility: best-effort timezone guess
function guessTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}

// Utility: full IANA tz list (trimmed popular + common)
// You can replace with a smaller curated set if desired.
function getAllTimezones() {
  return [
    'UTC','Africa/Lagos','Africa/Cairo','Africa/Johannesburg','America/Los_Angeles','America/Denver','America/Chicago','America/New_York',
    'America/Sao_Paulo','Europe/London','Europe/Berlin','Europe/Paris','Europe/Madrid','Europe/Rome','Europe/Amsterdam',
    'Europe/Warsaw','Europe/Kiev','Asia/Dubai','Asia/Jerusalem','Asia/Kolkata','Asia/Singapore','Asia/Shanghai','Asia/Tokyo','Australia/Sydney'
  ];
}


   // --- Admin Users Manager (panel) ---
  async function renderAdminUsers() {
    const card = document.getElementById('adminUsersCard');
    if (!card) return;

    // Gate: Admin-only visibility
    const isAdmin = state.ui.role === 'Admin';
    card.hidden = !isAdmin;
    if (!isAdmin) return;

    // Load users from backend if missing/stale
    if (!state.users || !Array.isArray(state.users) || !state.users.length) {
      try {
       await hydrateFromBackend();
      } catch (e) {
        toast('Could not load users; showing local state');
      }
    }

    function handleDelete(u) {
      // guard: keep at least one Admin in the system
      if (u.role === 'Admin' && countAdmins() <= 1) {
        toast('Cannot delete the only Admin');
        return;
      }

      // confirmation (simple and effective)
      const ok = confirm(`Delete user "${u.name}"? This cannot be undone.`);
      if (!ok) return;

      // if this user is open in the modal, close it
      const modal = $('#userModal');
      if (modal.open && modal.dataset.userId === u.id) modal.close();

      // remove
      state.users = state.users.filter(x => x.id !== u.id);
      save();
      renderAdminUsers();
      toast(`user ${u.name} deleted`);
    }

    function countAdmins() {
      return state.users.filter(x => x.role === 'Admin').length;
    }

    // Render table
    const tbody = document.querySelector('#usersTable tbody');
    tbody.innerHTML = state.users.map(u => `
      <tr data-id="${u.id}">
        <td>${escapeHtml(u.name)}<div class="meta">${escapeHtml(u.email || '')}</div></td>
        <td>${escapeHtml(u.role)}</td>
        <td title="${escapeHtml((u.privileges || []).join(', '))}">
          ${(u.privileges || []).slice(0,4).join(', ')}${(u.privileges || []).length > 4 ? '…' : ''}
        </td>
        <td>
          <div class="admin-btn-row">
            <button class="btn sm" data-edit="${u.id}">Edit</button>
            <button class="btn sm" data-download="${u.id}">Download</button>
            <button class="btn sm" data-email="${u.id}">Email</button>
            <button class="btn sm danger" data-delete="${u.id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');

    document.getElementById('usersSummary').textContent =
      `${state.users.length} user${state.users.length !== 1 ? 's' : ''} total`;

    // Form & controls
    const form = document.getElementById('userForm');
    const btnAdd = document.getElementById('btnAddUser');
    const btnCancel = document.getElementById('btnCancelUser');
    const btnGen = document.getElementById('btnGenPass');
    const btnSave = document.getElementById('btnSaveUser');
    const fieldName = document.getElementById('ufName');
    const fieldEmail = document.getElementById('ufEmail');
    const fieldRole = document.getElementById('ufRole');
    const fieldPass = document.getElementById('ufPassword');

    // Avoid duplicate bindings across route revisits
    if (!card.dataset.bound) {
      on(btnAdd, 'click', () => openForm());
      on(btnCancel, 'click', () => closeForm());
      on(btnGen, 'click', () => { fieldPass.value = generatePassword(); fieldPass.focus(); });

      on(btnSave, 'click', (e) => {
        e.preventDefault();
        const payload = collectForm();
        const editingId = form.dataset.editing || null;

        if (editingId) {
          const idx = state.users.findIndex(u => u.id === editingId);
          if (idx > -1) {
            state.users[idx] = Object.assign({}, state.users[idx], payload);
          }
        } else {
          state.users.unshift(Object.assign({ id: uuid(), createdAt: Date.now() }, payload));
          toast(`new user ${payload.name} added`);
          openUserModal(state.users[0]); // newest
        }

        save();
        renderAdminUsers();
        closeForm();
      });

      // Row actions: edit / download / email
      on(tbody, 'click', (e) => {
        const row = e.target.closest('tr'); if (!row) return;
        const id = row.dataset.id;
        const user = state.users.find(u => u.id === id); if (!user) return;

        if (e.target.matches('[data-edit]')) openForm(user);
        if (e.target.matches('[data-download]')) downloadCreds(user);
        if (e.target.matches('[data-email]')) emailCreds(user);
        if (e.target.matches('[data-delete]')) handleDelete(user);
      });

      // Modal
      on($('#umClose'), 'click', () => $('#userModal').close());
      on($('#umDownload'), 'click', () => { const u = currentModalUser(); if (u) downloadCreds(u); });
      on($('#umEmail'), 'click', () => { const u = currentModalUser(); if (u) emailCreds(u); });
      on($('#umEdit'), 'click', () => { const u = currentModalUser(); if (u) { $('#userModal').close(); openForm(u); } });

      card.dataset.bound = '1';
    }

    // ----- helpers -----
    function openForm(u = null) {
      form.hidden = false;
      form.dataset.editing = u?.id || '';
      fieldName.value = u?.name || '';
      fieldEmail.value = u?.email || '';
      fieldRole.value = u?.role || 'Member';
      fieldPass.value = u?.password || generatePassword();
      $$('#adminUsersCard .priv-checks input[type="checkbox"]').forEach(cb => {
        cb.checked = u ? (u.privileges || []).includes(cb.value) : (cb.value === 'users.read');
      });
      fieldName.focus();
    }

    function closeForm() {
      form.hidden = true; form.dataset.editing = ''; form.reset();
    }

    function collectForm() {
      const privs = $$('#adminUsersCard .priv-checks input[type="checkbox"]:checked').map(cb => cb.value);
      return {
        name: fieldName.value.trim(),
        email: fieldEmail.value.trim(),
        role: fieldRole.value,
        privileges: privs.length ? privs : ['users.read'],
        password: fieldPass.value.trim() || generatePassword()
      };
    }

    function openUserModal(u) {
      $('#umName').textContent = u.name;
      const modal = $('#userModal');
      modal.dataset.userId = u.id;
      modal.showModal();
    }

    function currentModalUser() {
      const id = $('#userModal').dataset.userId;
      return state.users.find(u => u.id === id);
    }

    function downloadCreds(u) {
      const creds = makeCredentialBundle(u);
      const asJson = JSON.stringify(creds, null, 2);
      if ('showSaveFilePicker' in window) {
        (async () => {
          const handle = await window.showSaveFilePicker({
            suggestedName: `${slug(u.name)}-credentials.json`,
            types: [{ description: 'Credentials JSON', accept: { 'application/json': ['.json'] } }]
          });
          const writable = await handle.createWritable();
          await writable.write(asJson);
          await writable.close();
          toast('Credentials saved to disk');
        })().catch(() => download(`${slug(u.name)}-credentials.json`, asJson, 'application/json'));
      } else {
        // Fallback: direct download
        download(`${slug(u.name)}-credentials.json`, asJson, 'application/json');
      }
    }

    function emailCreds(u) {
      const creds = makeCredentialBundle(u);
      const body =
  `Hello ${u.name},

  Your account has been created.

  Email: ${u.email}
  Role: ${u.role}
  Privileges: ${(u.privileges || []).join(', ')}
  Temporary password: ${u.password}

  You can log in from the landing page. Please change your password after first sign-in.`;
      const url = `mailto:${encodeURIComponent(u.email)}?subject=${encodeURIComponent('Your new account credentials')}&body=${encodeURIComponent(body)}`;
      location.href = url;
    }

    function makeCredentialBundle(u) {
      return {
        name: u.name,
        email: u.email,
        role: u.role,
        privileges: u.privileges || [],
        temporaryPassword: u.password,
        createdAt: new Date(u.createdAt || Date.now()).toISOString()
      };
    }

    function generatePassword(len = 12) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
      let out = '';
      for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
      return out;
    }

    function slug(s) {
      return String(s || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }

    function escapeHtml(str) {
      return String(str || '').replace(/[&<>"']/g, m => (
        {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]
      ));
    }

    // ===== Styled logout confirm =====
    (function () {
      const STORAGE_KEY = "project_unified_dashboard_state_v1";

      const logoutLink = document.getElementById("logoutLink")
                        || document.querySelector("[data-logout]")
                        || document.querySelector('a.nav-link[href="/index.html"]'); // fallback

      const dlg  = document.getElementById("logoutConfirm");
      if (!logoutLink || !dlg) return;

      const form = dlg.querySelector("form");
      const xBtn = dlg.querySelector(".icon-btn");
      const cancelBtn = document.getElementById("logoutCancelBtn");
      const confirmBtn = document.getElementById("logoutConfirmBtn");

      function openModal() {
        try { dlg.showModal(); } catch { /* dialog may already be open */ }
        confirmBtn?.focus();
      }

      function closeModal() {
        try { dlg.close(); } catch {}
      }

      function setBusy(busy) {
        if (!confirmBtn) return;
        confirmBtn.disabled = !!busy;
        confirmBtn.textContent = busy ? "Logging out…" : "Log out";
      }
    
      function clearLocalState() {
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
      }
    
      async function doServerLogout() {
        // call your API to clear the session + cookie
        await fetch("/api/logout", {
          method: "POST",
          credentials: "include",
          headers: { "content-type":"application/json" }
        }).catch(() => {}); // ignore network failures
      }
    
      // Open the styled popup instead of navigating
      logoutLink.addEventListener("click", (e) => {
        e.preventDefault();
        openModal();
      });
    
      // Close handlers
      xBtn?.addEventListener("click", (e) => { e.preventDefault(); closeModal(); });
      cancelBtn?.addEventListener("click", (e) => { e.preventDefault(); closeModal(); });
    
      // Clicking backdrop closes dialog
      dlg.addEventListener("click", (e) => {
        const card = dlg.querySelector(".modal-card");
        if (!card) return;
        const r = card.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) closeModal();
      });
    
      // Submit = confirm logout
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await doServerLogout();
        } finally {
          clearLocalState();
          setBusy(false);
          closeModal();
          // send them to your landing with login modal hint
          location.href = "/index.html#login";
        }
      });

      function prepareSidebarLabels(){
        $$('#sidebar .nav-link').forEach(link => {
          if (link.dataset.prepared) return;
          link.dataset.prepared = '1';

          // Grab icon element (span/i) and derive label from remaining text
          const iconEl = link.querySelector('span, i');
          const iconText = iconEl ? iconEl.textContent : '';
          const label = link.textContent.replace(iconText, '').trim();

          if (label) {
            // Create a <span class="label">…</span> to allow CSS hide/show
            const labelSpan = document.createElement('span');
            labelSpan.className = 'label';
            labelSpan.textContent = label;

            // Remove stray text nodes and append back cleanly
            Array.from(link.childNodes).forEach(n => { if (n.nodeType === Node.TEXT_NODE) n.remove(); });
            if (iconEl && iconEl.parentNode !== link) link.prepend(iconEl);
            link.appendChild(labelSpan);

            // Tooltip text for icon-only
            link.setAttribute('data-tip', label);
            link.setAttribute('aria-label', label);
          }
        });
      }

    })();
  }


  // Sounds via WebAudio API (tiny beeps)
  function playSound(kind='default'){
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = ({default: 660, priority: 880, dm: 520, mention: 740, taskDue: 400}[kind]||660);
    g.gain.setValueAtTime(.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(.09, ctx.currentTime+.01);
    g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime+.22);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime+.24);
  }

  // Settings Panel shortcut
  on($('#btnSettings'), 'click', ()=> showSheet('settingsPanel'));
  on($('#btnCloseSettings'), 'click', ()=> hideSheet('settingsPanel'));

  // Quick Actions & Assistant (Home)
  $$('[data-action="quickCompose"]').forEach(b=> on(b,'click',()=>{ pushNotif({title:'Compose', body:'New email draft created', priority:false}); }));
  $$('[data-action="quickNewTask"]').forEach(b=> on(b,'click',()=> quickNewTask()));
  $$('[data-action="quickLogTime"]').forEach(b=> on(b,'click',()=>{ location.hash = '#/workspace/time'; }));
  $$('[data-action="quickCreateEvent"]').forEach(b=> on(b,'click',()=>{ location.hash = '#/calendar'; $('#btnNewEvent').click(); }));
  $$('[data-action="quickStartMeeting"]').forEach(b=> on(b,'click',()=>{ pushNotif({title:'Meeting started', body:'Room: PU‑Daily', priority:true}); }));

  $$('[data-action="assistSummary"]').forEach(b=> on(b,'click',()=> assistSummary()));
  $$('[data-action="assistPlan"]').forEach(b=> on(b,'click',()=> assistPlan()));
  function assistSummary(){ $('#assistantOut').textContent = `You have ${state.tasks.length} tasks, ${state.calendar.events.length} events, and ${state.inbox.items.filter(m=>m.unread).length} unread messages.`; }
  function assistPlan(){ $('#assistantOut').textContent = 'Plan: 1) Clear Inbox (15m) 2) Draft brief (60m) 3) Calendar review (10m) 4) Dev focus (90m).'; }

  // Topbar shortcuts
  on(window,'keydown',(e)=>{
    if (e.altKey && e.key.toLowerCase()==='s'){ e.preventDefault(); toggleSidebar(); }
    if (e.altKey && e.key.toLowerCase()==='n'){ e.preventDefault(); $('#btnNew').click(); }
    if (e.altKey && e.shiftKey && e.key.toLowerCase()==='n'){ e.preventDefault(); $('#btnNotifications').click(); }
  });

  // Nav clicks respect role visibility
  $$('#sidebar .nav-link').forEach(a=> on(a,'click',()=> a.blur()));

  // Deep links from buttons using data-nav
  $$('[data-nav]').forEach(btn => on(btn,'click',()=>{ location.hash = btn.dataset.nav; }));

  // Bind once on first load
  window.addEventListener('DOMContentLoaded', async () => {
    if (location.hash.includes('/admin') || location.pathname.endsWith('/admin')) {
      renderAdmin();
    }
    try {
      await hydrateFromBackend();
    } catch (e) {
      // Not fatal; UI will still work with whatever is in local state
      console.warn('hydrate failed:', e);
    }
    await renderAdminUsers(); // render with real 
    
    prepareSidebarLabels();
  });


  // Boot
  applyThemeFromState();
  initUserSettings();      // <-- NEW: create defaults + bind panel once
  applyUserSettings(); 
  applyRoleVisibility();
  renderNotifs();
  navigate(location.hash||'#/');
  on(window, 'hashchange', ()=> navigate(location.hash));

  // First‑time seed notification
  if (!(load()?.firstBooted)){
    pushNotif({title:'Welcome to Perfect Unified', body:'Use ⌘K for the command palette. Try New → Task.', priority:false});
    state.firstBooted = true; save();
  }
})();
