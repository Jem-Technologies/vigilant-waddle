/* Perfect Unified — app.js
   Single-file SPA-style prototype (no frameworks).
   Persists minimal state to localStorage.
*/

(() => {
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const on = (el, ev, cb, opts) => el.addEventListener(ev, cb, opts);
  const storage = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  };

  // ---------- App State ----------
  const AppState = {
    user: storage.get('pu.user', { id: 'me', name: 'You', role: 'Admin', org: 'my-org', presence: 'available' }),
    settings: storage.get('pu.settings', {
      theme: { primary: '#4f46e5', wallpaper: 'none', density: 'comfortable', highContrast: false },
      sounds: 'default'
    }),
    data: storage.get('pu.data', seedData())
  };

  function saveAll() {
    storage.set('pu.user', AppState.user);
    storage.set('pu.settings', AppState.settings);
    storage.set('pu.data', AppState.data);
  }

  function seedData() {
    const now = Date.now();
    const mkId = (p='id') => p + '_' + Math.random().toString(36).slice(2,8);
    // Minimal datasets to light up UI (generic placeholders, no external assumptions)
    const tasks = [
      { id: mkId('t'), title: 'Draft project outline', status: 'todo', bucket: 'today', dueAt: now + 86400000, priority: 'P2', assignee: 'me' },
      { id: mkId('t'), title: 'Review design tokens', status: 'doing', bucket: 'next', dueAt: now + 2*86400000, priority: 'P3', assignee: 'me' },
      { id: mkId('t'), title: 'Prepare onboarding checklist', status: 'todo', bucket: 'later', dueAt: now + 4*86400000, priority: 'P3', assignee: 'me' },
      { id: mkId('t'), title: 'Update CRM pipeline', status: 'todo', bucket: 'today', dueAt: now + 86400000, priority: 'P2', assignee: 'me' }
    ];
    const projects = [
      { id: mkId('p'), name: 'Unified Inbox', key: 'UIX', status: 'Active' },
      { id: mkId('p'), name: 'Workspace Hub', key: 'WSH', status: 'Active' },
      { id: mkId('p'), name: 'Life & Scheduling', key: 'LFS', status: 'Planning' },
      { id: mkId('p'), name: 'Client Toolkit', key: 'CTK', status: 'Active' }
    ];
    const messages = [
      { id: mkId('m'), type: 'email', subject: 'Welcome to Perfect Unified', from: 'system', to: ['me'], ts: now-3600e3, unread: true, preview: 'This is your unified communications hub.', body: 'Thanks for trying the prototype. Use A/S/X/T keys for triage.' },
      { id: mkId('m'), type: 'chat', subject: 'General / Week Plan', from: 'User A', channel: 'general', ts: now-7200e3, unread: false, preview: 'What are our top goals this week?', body: 'Share priorities and blockers here.' },
      { id: mkId('m'), type: 'email', subject: 'Invoice Q3', from: 'Finance', to: ['me'], ts: now-1800e3, unread: true, preview: 'Invoice processing steps attached.', body: 'Please process the invoice by Friday.' }
    ];
    const threads = messages.map(m => ({ threadId: m.id, participants: ['me', m.from].filter(Boolean), tags: [], status: 'open', priority: 'normal', items: [
      { from: m.from || 'System', at: m.ts, text: m.body }
    ], attachments: [] }));
    const notifications = [
      { id: mkId('n'), type: 'inbox', text: '2 new messages', ts: now-120e3 },
      { id: mkId('n'), type: 'task', text: 'Task "Draft project outline" due tomorrow', ts: now-60e3 },
      { id: mkId('n'), type: 'crm', text: 'New lead added to pipeline', ts: now-30e3 }
    ];
    const events = [
      { id: mkId('e'), title: 'Standup', start: new Date().setHours(9,30,0,0), end: new Date().setHours(10,0,0,0), location: '', attendees: ['me'] },
      { id: mkId('e'), title: 'Planning', start: new Date().setDate(new Date().getDate()+1), end: new Date().setDate(new Date().getDate()+1)+3600e3, location: '', attendees: ['me'] }
    ];
    const deals = [
      { id: mkId('d'), title: 'Acme Co — Website', value: 12000, stage: 'lead' },
      { id: mkId('d'), title: 'Beta LLC — Support Plan', value: 4800, stage: 'qualified' }
    ];
    const sequences = [
      { id: mkId('s'), name: 'Lead Nurture', steps: [{ afterHours:0, type:'email', template:'Thanks for reaching out!' }, { afterHours:48, type:'email', template:'Quick follow-up' }] }
    ];
    const brandDNA = { mission: '', sliders: { formal:50, playful:50, enth:50 }, banned: [] };
    const invoices = [
      { id: 'INV-0001', client: 'Acme Co', amount: 12000, status: 'Open', due: new Date(Date.now()+7*86400000).toISOString().slice(0,10) },
      { id: 'INV-0002', client: 'Beta LLC', amount: 4800, status: 'Paid', due: new Date(Date.now()-3*86400000).toISOString().slice(0,10) }
    ];
    const subs = [
      { client: 'Gamma Inc', plan: 'Business', status: 'Active', started: new Date(Date.now()-30*86400000).toISOString().slice(0,10), cancelAt: '' }
    ];
    const desks = { cols: 12, total: 84, bookings: {} };
    const rules = [
      {
        id: mkId('r'),
        trigger: 'message.received',
        conditions: { type: 'email', subjectContains: ['invoice','payment'] },
        actions: [
          { type: 'label.add', label: 'Finance' },
          { type: 'task.create', title: 'Process invoice' },
          { type: 'notify', users: ['@team'], message: 'New invoice email' }
        ],
        enabled: true
      }
    ];
    const timeEntries = [];
    const notes = [
      { id: mkId('note'), title: 'Kickoff Notes', blocks: '## Agenda\n- Scope\n- Timeline\n- Risks', tags: ['meeting'], updatedAt: now }
    ];
    return { tasks, projects, messages, threads, notifications, events, deals, sequences, brandDNA, invoices, subs, desks, rules, timeEntries, notes };
  }

  // ---------- Theme & Settings ----------
  function applySettings() {
    document.documentElement.setAttribute('data-density', AppState.settings.theme.density);
    document.body.classList.remove('wp-gradient', 'wp-dots');
    if (AppState.settings.theme.wallpaper === 'gradient') document.body.classList.add('wp-gradient');
    if (AppState.settings.theme.wallpaper === 'dots') document.body.classList.add('wp-dots');
    document.documentElement.style.setProperty('--primary', AppState.settings.theme.primary);
    if (AppState.settings.theme.highContrast) {
      document.documentElement.style.setProperty('--line', '1px solid rgba(255,255,255,.35)');
    } else {
      document.documentElement.style.setProperty('--line', '1px solid rgba(255,255,255,.08)');
    }
    // Presence dot
    const dot = $('#presenceDot');
    const status = AppState.user.presence;
    dot.style.background = (status === 'available') ? 'var(--success)'
      : (status === 'busy') ? 'var(--warning)'
      : (status === 'away') ? 'var(--text-muted)'
      : 'var(--danger)';
  }

  // ---------- Router ----------
  const routes = new Set($$('.route').map(s => s.getAttribute('data-route')));
  function setRoute(hash) {
    const r = (hash || location.hash || '#/').replace(/^#/, '');
    const route = routes.has(r) ? r : '/';
    $$('.route').forEach(sec => sec.classList.toggle('active', sec.getAttribute('data-route') === route));
    // Highlight nav
    $$('#sidebar .nav-link').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#'+route));
    // Accessibility: focus main
    $('#main').focus();
    // Context panels default hidden
    $('#contextPanel')?.setAttribute('hidden','');
    $('#chatContext')?.setAttribute('hidden','');
    // Update page-specific UIs
    if (route === '/') renderHome();
    if (route.startsWith('/inbox')) renderInbox();
    if (route === '/chat') renderChat();
    if (route === '/workspace/projects') renderProjects();
    if (route === '/workspace/my-tasks') renderMyTasks();
    if (route === '/workspace/boards') renderKanban();
    if (route === '/workspace/time') renderTime();
    if (route === '/workspace/automations') renderRules();
    if (route === '/calendar') renderCalendar();
    if (route === '/notes') renderNotes();
    if (route === '/clients/crm') renderCRM();
    if (route === '/clients/billing') renderBilling();
    if (route === '/twin') renderTwin();
    if (route === '/reports') renderReports();
  }
  on(window, 'hashchange', () => setRoute(location.hash));

  // ---------- Role-aware navigation ----------
  function applyRole() {
    const role = AppState.user.role;
    $$('#sidebar [data-roles]').forEach(el => {
      const roles = el.getAttribute('data-roles').split(',').map(s=>s.trim());
      el.parentElement.style.display = roles.includes(role) ? '' : 'none';
    });
  }

  // ---------- Topbar interactions ----------
  function initTopbar() {
    on($('#cmdkBtn'), 'click', openCmdk);
    on($('#btnNotifications'), 'click', toggleNotif);
    on($('#btnSettings'), 'click', () => $('#settingsPanel').hidden = false);
    on($('#btnCloseSettings'), 'click', () => $('#settingsPanel').hidden = true);
    on($('#btnSidebar'), 'click', () => $('#sidebar').classList.toggle('open'));
    on($('#btnNew'), 'click', e => {
      const m = $('#newMenu'); m.hidden = !m.hidden;
      m.style.top = `${e.target.getBoundingClientRect().bottom + 6 + window.scrollY}px`;
      m.style.left = `${e.target.getBoundingClientRect().left}px`;
    });
    on(document, 'click', e => {
      if (!$('#newMenu').contains(e.target) && e.target !== $('#btnNew')) $('#newMenu').hidden = true;
    });
    on($('#newMenu'), 'click', e => {
      if (e.target.matches('[data-action]')) {
        runQuickAction(e.target.getAttribute('data-action'));
        $('#newMenu').hidden = true;
      }
    });
    on($('#presenceSelect'), 'change', e => {
      AppState.user.presence = e.target.value; saveAll(); applySettings();
    });
    on($('#roleSelect'), 'change', e => {
      AppState.user.role = e.target.value; saveAll(); applyRole();
    });
    // Global Search
    const gs = $('#globalSearch');
    const res = $('#searchResults');
    on(gs, 'focus', () => res.hidden = false);
    on(gs, 'blur', () => setTimeout(()=> res.hidden = true, 150));
    on(gs, 'input', () => renderGlobalSearch(gs.value));
  }

  function runQuickAction(action) {
    switch(action) {
      case 'newEmail':
      case 'quickCompose':
        location.hash = '#/inbox'; setTimeout(()=> openComposer(), 50); break;
      case 'newTask':
      case 'quickNewTask':
        location.hash = '#/workspace/my-tasks'; setTimeout(()=> openNewTask(), 50); break;
      case 'newEvent':
      case 'quickCreateEvent':
        location.hash = '#/calendar'; setTimeout(()=> newEventPrompt(), 50); break;
      case 'newNote':
        location.hash = '#/notes'; setTimeout(()=> newNote(), 50); break;
      case 'newDeal':
        location.hash = '#/clients/crm'; setTimeout(()=> newDealPrompt(), 50); break;
      case 'newAutomation':
        location.hash = '#/workspace/automations'; break;
      case 'inviteUser':
        toast('Invite link copied to clipboard'); navigator.clipboard.writeText('https://example.com/invite'); break;
      case 'quickLogTime':
        location.hash = '#/workspace/time'; break;
      case 'quickStartMeeting':
        toast('Meeting link created'); break;
    }
  }

  // ---------- Notifications ----------
  function renderNotifications() {
    const groups = $('#notifGroups');
    groups.innerHTML = '';
    const byType = {};
    AppState.data.notifications.forEach(n => {
      (byType[n.type] = byType[n.type] || []).push(n);
    });
    for (const [type, items] of Object.entries(byType)) {
      const box = document.createElement('section');
      box.className = 'card';
      const pretty = type.toUpperCase();
      box.innerHTML = `<header><h3>${pretty}</h3></header>`;
      const ul = document.createElement('ul');
      ul.className = 'list';
      items.forEach(i => {
        const li = document.createElement('li');
        li.className = 'item';
        li.textContent = i.text;
        ul.appendChild(li);
      });
      box.appendChild(ul);
      groups.appendChild(box);
    }
    $('#notifCount').textContent = AppState.data.notifications.length.toString();
  }

  function toggleNotif() {
    renderNotifications();
    const panel = $('#notifPanel');
    const open = panel.hasAttribute('hidden');
    panel.toggleAttribute('hidden', !open);
    $('#btnNotifications').setAttribute('aria-expanded', String(open));
  }
  on($('#btnCloseNotif'), 'click', () => $('#notifPanel').hidden = true);

  // ---------- Command Palette ----------
  const cmds = [
    { title: 'Go: Home', run: () => location.hash = '#/' },
    { title: 'Go: Inbox', run: () => location.hash = '#/inbox' },
    { title: 'Go: Chat', run: () => location.hash = '#/chat' },
    { title: 'Go: Projects', run: () => location.hash = '#/workspace/projects' },
    { title: 'Go: My Tasks', run: () => location.hash = '#/workspace/my-tasks' },
    { title: 'Go: Calendar', run: () => location.hash = '#/calendar' },
    { title: 'Go: Notes', run: () => location.hash = '#/notes' },
    { title: 'Go: CRM', run: () => location.hash = '#/clients/crm' },
    { title: 'New: Email', run: () => runQuickAction('newEmail') },
    { title: 'New: Task', run: () => runQuickAction('newTask') },
    { title: 'New: Event', run: () => runQuickAction('newEvent') },
    { title: 'New: Note', run: () => runQuickAction('newNote') },
  ];
  function openCmdk() {
    const dlg = $('#cmdk');
    const input = $('#cmdkInput');
    const list = $('#cmdkList');
    dlg.showModal();
    input.value = '';
    renderCmdk('');
    setTimeout(()=> input.focus(), 20);

    function renderCmdk(q) {
      list.innerHTML = '';
      const res = cmds.filter(c => c.title.toLowerCase().includes(q.toLowerCase()));
      res.forEach((c,i) => {
        const li = document.createElement('li');
        li.textContent = c.title;
        li.setAttribute('role', 'option');
        if (i === 0) li.setAttribute('aria-selected','true');
        on(li, 'click', () => { c.run(); dlg.close(); });
        list.appendChild(li);
      });
    }
    on($('#cmdkInput'), 'input', e => renderCmdk(e.target.value), { once: true });
    on($('#cmdkForm'), 'submit', e => {
      e.preventDefault();
      const sel = $('#cmdkList li[aria-selected="true"]');
      const idx = $$('#cmdkList li').indexOf ? $$('#cmdkList li').indexOf(sel) : 0;
      (cmds.filter(c => c.title.toLowerCase().includes($('#cmdkInput').value.toLowerCase()))[idx] || cmds[0]).run();
      dlg.close();
    }, { once: true });
    on($('#cmdk'), 'keydown', e => {
      if (e.key === 'Escape') dlg.close();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = $$('#cmdkList li'); let idx = items.findIndex(li => li.getAttribute('aria-selected') === 'true');
        idx = idx < 0 ? 0 : idx; idx = e.key === 'ArrowDown' ? Math.min(idx+1, items.length-1) : Math.max(idx-1,0);
        items.forEach((li,i) => li.setAttribute('aria-selected', i===idx ? 'true' : 'false'));
      }
    }, { once: true });
  }

  // ---------- Global Search ----------
  function renderGlobalSearch(q) {
    const box = $('#searchResults');
    box.innerHTML = '';
    if (!q) return;
    const add = (type, label, onClick) => {
      const div = document.createElement('div');
      div.className = 'res';
      div.innerHTML = `<span>${label}</span><span class="muted">${type}</span>`;
      on(div, 'mousedown', (e) => { e.preventDefault(); onClick(); });
      box.appendChild(div);
    };
    // Messages
    AppState.data.messages.filter(m => JSON.stringify(m).toLowerCase().includes(q.toLowerCase()))
      .slice(0,6).forEach(m => add('message', m.subject, () => { location.hash = '#/inbox'; setTimeout(()=> openThread(m.id), 10); }));
    // Tasks
    AppState.data.tasks.filter(t => t.title.toLowerCase().includes(q.toLowerCase()))
      .slice(0,6).forEach(t => add('task', t.title, () => { location.hash = '#/workspace/my-tasks'; }));
    // Notes
    AppState.data.notes.filter(n => (n.title + n.blocks).toLowerCase().includes(q.toLowerCase()))
      .slice(0,4).forEach(n => add('note', n.title, () => { location.hash = '#/notes'; }));
    // Deals
    AppState.data.deals.filter(d => d.title.toLowerCase().includes(q.toLowerCase()))
      .slice(0,4).forEach(d => add('deal', d.title, () => { location.hash = '#/clients/crm'; }));
    // Invoices
    AppState.data.invoices.filter(inv => inv.id.toLowerCase().includes(q.toLowerCase()) || inv.client.toLowerCase().includes(q.toLowerCase()))
      .slice(0,4).forEach(inv => add('invoice', `${inv.id} — ${inv.client}`, () => { location.hash = '#/clients/billing'; }));
  }

  // ---------- Home ----------
  function renderHome() {
    const my = AppState.data.tasks.filter(t => t.assignee === 'me').slice(0,5);
    $('#homeMyTasks').innerHTML = my.map(t => `<li class="item"><strong>${t.title}</strong><span class="meta"> • ${t.status}</span></li>`).join('') || '<li class="item">No tasks</li>';
    const evs = AppState.data.events.slice(0,5);
    $('#homeEvents').innerHTML = evs.map(e => `<li class="item"><strong>${fmtDateTime(e.start)}</strong> — ${e.title}</li>`).join('') || '<li class="item">No events</li>';
    const inbox = AppState.data.messages.slice(0,5);
    $('#homeInbox').innerHTML = inbox.map(m => `<li class="item"><strong>${m.subject}</strong><span class="meta"> • ${m.type}</span></li>`).join('') || '<li class="item">No messages</li>';
    // KPIs (dummy numbers for visualization only)
    $('#kpiRevenue').textContent = '$' + (Math.floor(Math.random()*50)+50) + 'k';
    $('#kpiUtilization').textContent = (Math.floor(Math.random()*35)+60) + '%';
    $('#kpiCSAT').textContent = (Math.floor(Math.random()*10)+88) + '%';
    $('#kpiCycle').textContent = (Math.floor(Math.random()*6)+5) + 'd';
  }

  // ---------- Inbox ----------
  let inboxFilter = 'all';
  function renderInbox() {
    // Smart Views
    $('#smartViews').innerHTML = ['Finance','Mentions','Waiting','VIP'].map(tag => `<li class="item">${tag}</li>`).join('');
    // Filters
    $$('#/inbox .chip');
    $$('.filters .chip').forEach(ch => on(ch, 'click', () => {
      $$('.filters .chip').forEach(c => c.classList.remove('active')); ch.classList.add('active');
      inboxFilter = ch.getAttribute('data-filter'); renderInboxList();
    }, { once: true }));
    renderInboxList();
  }
  function renderInboxList() {
    const box = $('#inboxList');
    const msgs = AppState.data.messages.filter(m => {
      if (inboxFilter === 'all') return true;
      if (inboxFilter === 'unread') return m.unread;
      if (inboxFilter === 'mentions') return /@/.test(m.preview || m.body || '');
      if (inboxFilter === 'assigned') return m.assigned === 'me';
      return true;
    });
    box.innerHTML = msgs.map(m => `
      <div class="inbox-item" data-id="${m.id}" tabindex="0" role="option" aria-label="${m.subject}">
        <div class="avatar">${m.type === 'email' ? '✉︎' : '💬'}</div>
        <div class="grow">
          <div><strong>${escapeHTML(m.subject)}</strong> ${m.unread ? '<span class="badge">new</span>' : ''}</div>
          <div class="meta">${m.type} • ${timeAgo(m.ts)} • ${m.from || '—'}</div>
          <div class="muted">${escapeHTML(m.preview || '')}</div>
        </div>
      </div>
    `).join('');
    $$('#inboxList .inbox-item').forEach(el => {
      on(el, 'click', () => openThread(el.getAttribute('data-id')));
      on(el, 'keydown', e => {
        if (['Enter',' '].includes(e.key)) openThread(el.getAttribute('data-id'));
        if (e.key.toLowerCase() === 'a') { assignMessage(el.getAttribute('data-id'), 'me'); }
        if (e.key.toLowerCase() === 's') { snoozeMessage(el.getAttribute('data-id')); }
        if (e.key.toLowerCase() === 'x') { closeThread(el.getAttribute('data-id')); }
        if (e.key.toLowerCase() === 't') { convertToTask(el.getAttribute('data-id')); }
      });
    });
  }
  function openThread(id) {
    const m = AppState.data.messages.find(x => x.id === id);
    if (!m) return;
    m.unread = false; saveAll();
    const t = AppState.data.threads.find(t => t.threadId === m.id);
    const tv = $('#threadView'); tv.innerHTML = '';
    const head = document.createElement('div');
    head.innerHTML = `<div class="btn-row"><strong>${escapeHTML(m.subject)}</strong><span class="chip">${m.type}</span>
      <span class="spacer"></span>
      <button class="btn sm" data-act="assign">Assign</button>
      <button class="btn sm" data-act="snooze">Snooze</button>
      <button class="btn sm" data-act="close">Close</button>
      <button class="btn sm" data-act="task">Convert to Task</button>
      <button class="btn sm" data-act="details">Details</button>
    </div>`;
    tv.appendChild(head);
    // Body
    t.items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'message';
      div.innerHTML = `<div class="avatar">👤</div><div><div class="meta">${item.from} • ${timeAgo(item.at)}</div><div>${escapeHTML(item.text)}</div>${renderAttachments(item.attachments)}</div>`;
      tv.appendChild(div);
    });
    // Composer
    const comp = document.createElement('div');
    comp.className = 'composer';
    comp.innerHTML = `
      <textarea id="replyBox" rows="3" placeholder="Reply… (E to focus)" aria-label="Reply"></textarea>
      <div class="composer-actions">
        <input type="file" id="inboxAttach" multiple hidden>
        <button class="icon-btn" id="inboxAttachBtn" title="Attach file">📎</button>
        <button class="icon-btn" id="inboxRecordBtn" title="Record voice note">🎙</button>
        <button class="btn primary" id="replySend">Send</button>
      </div>
    `;
    tv.appendChild(comp);
    on($('#inboxAttachBtn'), 'click', () => $('#inboxAttach').click());
    on($('#inboxAttach'), 'change', e => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      t.items.push({ from: 'You', at: Date.now(), text: '(attachments)', attachments: files.map(f => ({ name: f.name, size: f.size })) });
      saveAll(); openThread(id);
    });
    // Voice recording
    on($('#inboxRecordBtn'), 'click', () => recordVoice((blobUrl) => {
      t.items.push({ from: 'You', at: Date.now(), text: '(voice note)', attachments: [{ audio: blobUrl }] });
      saveAll(); openThread(id);
    }));
    on($('#replySend'), 'click', () => {
      const txt = $('#replyBox').value.trim(); if (!txt) return;
      t.items.push({ from: 'You', at: Date.now(), text: txt });
      saveAll(); openThread(id);
    });
    on(head, 'click', e => {
      if (!e.target.matches('button[data-act]')) return;
      const act = e.target.getAttribute('data-act');
      if (act === 'assign') assignMessage(id, 'me');
      if (act === 'snooze') snoozeMessage(id);
      if (act === 'close') closeThread(id);
      if (act === 'task') convertToTask(id);
      if (act === 'details') { renderContextForThread(id); $('#contextPanel').hidden = false; }
    });
  }
  function renderAttachments(att) {
    if (!att || !att.length) return '';
    return `<div class="attachments">${att.map(a => a?.audio ? `<audio controls src="${a.audio}"></audio>` : `<span class="chip">${escapeHTML(a.name || 'file')}</span>`).join(' ')}</div>`;
  }
  function assignMessage(id, userId) {
    const m = AppState.data.messages.find(x => x.id === id); if (!m) return;
    m.assigned = userId; toast('Assigned'); playSound('mention'); saveAll(); renderInboxList();
  }
  function snoozeMessage(id) { toast('Snoozed'); }
  function closeThread(id) {
    const t = AppState.data.threads.find(t => t.threadId === id); if (!t) return;
    t.status = 'closed'; toast('Thread closed'); saveAll(); renderInboxList();
  }
  function convertToTask(id) {
    const m = AppState.data.messages.find(x => x.id === id); if (!m) return;
    AppState.data.tasks.push({ id: 't_' + id, title: m.subject, status: 'todo', bucket: 'next', dueAt: Date.now()+2*86400000, priority: 'P2', assignee: 'me' });
    toast('Task created from message'); playSound('taskDue'); saveAll();
  }
  function renderContextForThread(id) {
    const t = AppState.data.threads.find(t => t.threadId === id);
    const box = $('#contextContent');
    box.innerHTML = `
      <div class="muted">Participants</div>
      <div class="chips">${t.participants.map(p => `<span class="chip">@${escapeHTML(p)}</span>`).join(' ')}</div>
      <div class="muted" style="margin-top:8px;">Tags</div>
      <div class="chips">${t.tags.map(tag => `<span class="chip">${escapeHTML(tag)}</span>`).join(' ') || '<span class="muted">None</span>'}</div>
      <div class="muted" style="margin-top:8px;">Linked</div>
      <div class="chips"><span class="chip">0 tasks</span> <span class="chip">0 events</span></div>
    `;
  }
  on($('#btnCloseContext'), 'click', () => $('#contextPanel').hidden = true);

  function openComposer() {
    const firstMsg = AppState.data.messages[0];
    if (firstMsg) openThread(firstMsg.id);
    $('#replyBox')?.focus();
  }

  // ---------- Chat ----------
  function renderChat() {
    const list = $('#chatList');
    const channels = ['general','random','project-unified'];
    list.innerHTML = channels.map(ch => `<div class="item" data-ch="${ch}" tabindex="0"><strong>#${ch}</strong></div>`).join('');
    const msgsBox = $('#chatMessages');
    function loadChannel(ch) {
      msgsBox.innerHTML = '';
      const msgs = AppState.data.messages.filter(m => m.type === 'chat' && m.channel === ch);
      msgs.forEach(m => {
        msgsBox.insertAdjacentHTML('beforeend', `<div class="message${m.from==='You'?' me':''}"><div class="avatar">💬</div><div><div class="meta">${escapeHTML(m.from||'—')} • ${timeAgo(m.ts)}</div><div>${escapeHTML(m.body || m.preview || '')}</div></div></div>`);
      });
      $('#chatInfo').innerHTML = `<div class="muted">Channel: #${ch}</div><div class="muted">Members: 3</div>`;
    }
    loadChannel(channels[0]);
    $$('#chatList .item').forEach(el => on(el, 'click', () => loadChannel(el.getAttribute('data-ch'))));
    on($('#chatAttach'), 'click', () => $('#chatFile').click());
    on($('#chatFile'), 'change', e => {
      const f = e.target.files[0]; if (!f) return;
      $('#chatMessages').insertAdjacentHTML('beforeend', `<div class="message me"><div class="avatar">📎</div><div><div class="meta">You • now</div><div>Uploaded ${escapeHTML(f.name)}</div></div></div>`);
    });
    on($('#chatRecord'), 'click', () => recordVoice(url => {
      $('#chatMessages').insertAdjacentHTML('beforeend', `<div class="message me"><div class="avatar">🎙</div><div><div class="meta">You • now</div><audio controls src="${url}"></audio></div></div>`);
    }));
    on($('#chatSend'), 'click', () => {
      const txt = $('#chatInput').value.trim(); if (!txt) return;
      $('#chatMessages').insertAdjacentHTML('beforeend', `<div class="message me"><div class="avatar">🙂</div><div><div class="meta">You • now</div><div>${escapeHTML(txt)}</div></div></div>`);
      $('#chatInput').value = '';
    });
  }

  // ---------- Projects ----------
  function renderProjects() {
    const grid = $('#projectsGrid');
    grid.innerHTML = AppState.data.projects.map(p => `
      <article class="card">
        <header style="display:flex;justify-content:space-between;align-items:center;">
          <h3>${escapeHTML(p.name)}</h3>
          <span class="chip">${escapeHTML(p.status)}</span>
        </header>
        <div class="muted">Key: ${escapeHTML(p.key)}</div>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn sm" data-open="${p.id}">Open</button>
        </div>
      </article>
    `).join('');
    $$('#projectsGrid [data-open]').forEach(b => on(b, 'click', () => {
      toast('Project page — use Boards/Timeline in Workspace'); location.hash = '#/workspace/boards';
    }));
    on($('#btnNewProject'), 'click', () => {
      const name = prompt('Project name'); if (!name) return;
      AppState.data.projects.push({ id: 'p_' + Date.now(), name, key: name.slice(0,3).toUpperCase(), status: 'Active' });
      saveAll(); renderProjects();
    });
  }

  // ---------- My Tasks + Boards ----------
  function renderMyTasks() {
    const byBucket = { today: [], next: [], later: [] };
    AppState.data.tasks.filter(t => t.assignee === 'me').forEach(t => (byBucket[t.bucket]||byBucket.next).push(t));
    $('#bucketToday').innerHTML = byBucket.today.map(renderTask).join('') || '<li class="muted" style="padding:10px">No tasks</li>';
    $('#bucketNext').innerHTML = byBucket.next.map(renderTask).join('') || '<li class="muted" style="padding:10px">No tasks</li>';
    $('#bucketLater').innerHTML = byBucket.later.map(renderTask).join('') || '<li class="muted" style="padding:10px">No tasks</li>';
    enableTaskDrag();
  }
  function renderTask(t) {
    return `<li class="task" draggable="true" data-id="${t.id}"><input type="checkbox" ${t.status==='done'?'checked':''} data-check="${t.id}">
      <span>${escapeHTML(t.title)}</span><span class="meta">${t.priority}</span></li>`;
  }
  function enableTaskDrag() {
    $$('#/workspace/my-tasks .task');
    $$('.task').forEach(el => {
      on(el, 'dragstart', e => { el.classList.add('dragging'); e.dataTransfer.setData('text/plain', el.getAttribute('data-id')); });
      on(el, 'dragend', () => el.classList.remove('dragging'));
    });
    $$('.task-list').forEach(list => {
      on(list, 'dragover', e => { e.preventDefault(); });
      on(list, 'drop', e => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        const task = AppState.data.tasks.find(t => t.id === id);
        task.bucket = list.id === 'bucketToday' ? 'today' : list.id === 'bucketNext' ? 'next' : 'later';
        saveAll(); renderMyTasks(); renderKanban();
      });
    });
    $$('#/workspace/my-tasks [data-check]');
    $$('.task input[type="checkbox"]').forEach(cb => on(cb, 'change', e => {
      const t = AppState.data.tasks.find(x => x.id === cb.getAttribute('data-check'));
      t.status = cb.checked ? 'done' : 'todo'; saveAll(); renderKanban();
    }));
  }

  function renderKanban() {
    const col = (st) => $('#kan' + st[0].toUpperCase() + st.slice(1));
    if (!col('todo') || !col('doing') || !col('done')) return;
    const group = { todo: [], doing: [], done: [] };
    AppState.data.tasks.forEach(t => (group[t.status] || group.todo).push(t));
    col('todo').innerHTML = group.todo.map(t => `<div class="item" draggable="true" data-id="${t.id}">${escapeHTML(t.title)}</div>`).join('');
    col('doing').innerHTML = group.doing.map(t => `<div class="item" draggable="true" data-id="${t.id}">${escapeHTML(t.title)}</div>`).join('');
    col('done').innerHTML = group.done.map(t => `<div class="item" draggable="true" data-id="${t.id}">${escapeHTML(t.title)}</div>`).join('');
    // DnD
    $$('.kan-items .item').forEach(el => {
      on(el, 'dragstart', e => e.dataTransfer.setData('text/plain', el.getAttribute('data-id')));
    });
    $$('.kan-items').forEach(box => {
      on(box, 'dragover', e => e.preventDefault());
      on(box, 'drop', e => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        const t = AppState.data.tasks.find(x => x.id === id);
        t.status = box.id === 'kanTodo' ? 'todo' : box.id === 'kanDoing' ? 'doing' : 'done';
        saveAll(); renderKanban(); renderMyTasks();
      });
    });
  }

  // ---------- Time Tracking ----------
  let timer = { running: false, startAt: 0, interval: null, taskId: '' };
  function renderTime() {
    const sel = $('#timerTask');
    sel.innerHTML = AppState.data.tasks.map(t => `<option value="${t.id}">${escapeHTML(t.title)}</option>`).join('');
    $('#timeEntries tbody').innerHTML = AppState.data.timeEntries.map(e => `
      <tr><td>${escapeHTML(findTaskTitle(e.taskId))}</td><td>${fmtDateTime(e.started)}</td><td>${fmtDateTime(e.ended)}</td><td>${fmtDuration(e.duration)}</td><td>${e.billable?'Yes':'No'}</td><td>${escapeHTML(e.memo||'')}</td></tr>
    `).join('');
  }
  on($('#btnTimerStart'), 'click', () => {
    const t = $('#timerTask').value; if (!t) return;
    timer = { running: true, startAt: Date.now(), interval: setInterval(updateTimer, 1000), taskId: t };
    $('#btnTimerStart').disabled = true; $('#btnTimerStop').disabled = false;
  });
  on($('#btnTimerStop'), 'click', () => {
    if (!timer.running) return;
    clearInterval(timer.interval);
    const ended = Date.now(); const dur = Math.floor((ended - timer.startAt)/1000);
    AppState.data.timeEntries.push({ taskId: timer.taskId, started: timer.startAt, ended, duration: dur, billable: true, memo: '' });
    timer.running = false; $('#btnTimerStart').disabled = false; $('#btnTimerStop').disabled = true;
    $('#timerDisplay').textContent = '00:00:00'; saveAll(); renderTime();
  });
  on($('#btnExportCSV'), 'click', () => {
    const rows = [['Task','Started','Ended','Duration(s)','Billable','Memo']].concat(
      AppState.data.timeEntries.map(e => [findTaskTitle(e.taskId), new Date(e.started).toISOString(), new Date(e.ended).toISOString(), e.duration, e.billable?'Yes':'No', e.memo||''])
    );
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'time-entries.csv'; a.click();
  });
  function updateTimer() {
    const d = Math.floor((Date.now() - timer.startAt)/1000);
    $('#timerDisplay').textContent = fmtDuration(d);
  }
  function findTaskTitle(id) { return AppState.data.tasks.find(t => t.id === id)?.title || '—'; }

  // ---------- Automations ----------
  function renderRules() {
    $('#rulesList').innerHTML = AppState.data.rules.map(r => `<li class="item"><strong>${r.trigger}</strong> ${r.enabled ? '<span class="chip">enabled</span>' : '<span class="chip">disabled</span>'}</li>`).join('') || '<li class="item">No rules</li>';
  }
  on($('#btnNewRule'), 'click', () => {
    $('#ruleTrigger').value = 'message.received';
    $('#ruleConditions').value = '{"type":"email"}';
    $('#ruleActions').value = '[{"type":"notify","users":["@team"],"message":"New item"}]';
    $('#ruleEnabled').checked = true;
  });
  on($('#btnSaveRule'), 'click', e => {
    e.preventDefault();
    try {
      const rule = {
        id: 'r_' + Date.now(),
        trigger: $('#ruleTrigger').value,
        conditions: JSON.parse($('#ruleConditions').value || '{}'),
        actions: JSON.parse($('#ruleActions').value || '[]'),
        enabled: $('#ruleEnabled').checked
      };
      AppState.data.rules.push(rule); saveAll(); renderRules(); toast('Rule saved');
    } catch (err) { toast('Invalid JSON in conditions or actions'); }
  });
  on($('#btnTestRule'), 'click', e => {
    e.preventDefault();
    let output = '';
    try {
      const cond = JSON.parse($('#ruleConditions').value||'{}');
      const payload = { type: 'email', subject: 'Invoice 123', data: { amount: 1200 } };
      const matched = matchConditions(payload, cond);
      output += 'Payload: ' + JSON.stringify(payload, null, 2) + '\n\n';
      output += 'Conditions match: ' + matched + '\n';
      if (matched) {
        const actions = JSON.parse($('#ruleActions').value||'[]');
        output += 'Actions to run:\n' + JSON.stringify(actions, null, 2);
      }
    } catch (err) { output = 'Error: ' + err.message; }
    $('#ruleOutput').textContent = output;
  });
  function matchConditions(payload, cond) {
    return Object.entries(cond).every(([k,v]) => {
      if (k === 'subjectContains' && Array.isArray(v)) return v.some(token => (payload.subject||'').toLowerCase().includes(String(token).toLowerCase()));
      if (typeof v === 'object' && v !== null) return matchConditions(payload[k]||{}, v);
      return String(payload[k]) === String(v);
    });
  }

  // ---------- Calendar ----------
  let calView = 'month';
  function renderCalendar() {
    const cal = $('#calendar');
    cal.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'cal-grid ' + (calView === 'month' ? 'cal-month' : calView === 'week' ? 'cal-week' : 'cal-day');
    const today = new Date();
    if (calView === 'month') {
      // simple month grid (start at 1)
      const y = today.getFullYear(), m = today.getMonth();
      const first = new Date(y,m,1); const days = new Date(y,m+1,0).getDate();
      for (let d=1; d<=days; d++) {
        const cell = document.createElement('div');
        cell.className = 'cal-cell';
        cell.innerHTML = `<div class="muted">${d}</div>`;
        const dayStart = new Date(y,m,d).setHours(0,0,0,0);
        AppState.data.events.filter(e => new Date(e.start).toDateString() === new Date(dayStart).toDateString())
          .forEach(e => cell.insertAdjacentHTML('beforeend', `<a class="event" href="javascript:;" title="${escapeHTML(e.title)}">${escapeHTML(e.title)}</a>`));
        wrap.appendChild(cell);
      }
    } else if (calView === 'week') {
      for (let i=0;i<7;i++) {
        const day = new Date(today); day.setDate(today.getDate()-today.getDay()+i);
        const cell = document.createElement('div');
        cell.className = 'cal-cell';
        cell.innerHTML = `<div class="muted">${day.toLocaleDateString()}</div>`;
        AppState.data.events.filter(e => new Date(e.start).toDateString() === day.toDateString())
          .forEach(e => cell.insertAdjacentHTML('beforeend', `<span class="event">${escapeHTML(e.title)}</span>`));
        wrap.appendChild(cell);
      }
    } else {
      const cell = document.createElement('div'); cell.className = 'cal-cell';
      cell.innerHTML = `<div class="muted">${today.toDateString()}</div>`;
      AppState.data.events.filter(e => new Date(e.start).toDateString() === today.toDateString())
        .forEach(e => cell.insertAdjacentHTML('beforeend', `<span class="event">${escapeHTML(e.title)}</span>`));
      wrap.appendChild(cell);
    }
    cal.appendChild(wrap);
    $$('.toolbar [data-calview]').forEach(b => b.classList.toggle('primary', b.getAttribute('data-calview') === calView));
  }
  $$('.toolbar [data-calview]').forEach(b => on(b, 'click', () => { calView = b.getAttribute('data-calview'); renderCalendar(); }));
  on($('#btnNewEvent'), 'click', newEventPrompt);
  function newEventPrompt() {
    const title = prompt('Event title'); if (!title) return;
    const start = Date.now() + 3600e3; const end = start + 3600e3;
    AppState.data.events.push({ id: 'e_' + Date.now(), title, start, end, attendees: ['me'] });
    saveAll(); renderCalendar();
  }

  // ---------- Notes ----------
  let currentNoteId = null;
  function renderNotes() {
    $('#notesList').innerHTML = AppState.data.notes.map(n => `<li class="item" data-id="${n.id}" tabindex="0"><strong>${escapeHTML(n.title)}</strong><div class="muted">${new Date(n.updatedAt).toLocaleString()}</div></li>`).join('') || '<li class="item">No notes</li>';
    $$('#notesList .item').forEach(el => on(el, 'click', () => openNote(el.getAttribute('data-id'))));
    if (AppState.data.notes[0]) openNote(AppState.data.notes[0].id);
  }
  function openNote(id) {
    const n = AppState.data.notes.find(x => x.id === id); if (!n) return;
    currentNoteId = id;
    $('#noteTitle').value = n.title;
    $('#noteEditor').innerText = n.blocks;
    $('#noteMeta').textContent = 'Tags: ' + (n.tags||[]).join(', ');
  }
  on($('#btnNewNote'), 'click', newNote);
  function newNote() {
    const id = 'note_' + Date.now();
    const n = { id, title: 'Untitled', blocks: '', tags: [], updatedAt: Date.now() };
    AppState.data.notes.unshift(n); saveAll(); renderNotes(); openNote(id);
  }
  on($('#btnSaveNote'), 'click', () => {
    if (!currentNoteId) return;
    const n = AppState.data.notes.find(x => x.id === currentNoteId);
    n.title = $('#noteTitle').value; n.blocks = $('#noteEditor').innerText; n.updatedAt = Date.now();
    saveAll(); renderNotes(); toast('Note saved');
  });
  on($('#btnTagNote'), 'click', () => {
    if (!currentNoteId) return;
    const tag = prompt('Add tag'); if (!tag) return;
    const n = AppState.data.notes.find(x => x.id === currentNoteId);
    n.tags = Array.from(new Set([...(n.tags||[]), tag])); saveAll(); renderNotes();
  });
  on($('#btnExtractTasks'), 'click', () => {
    if (!currentNoteId) return;
    const text = $('#noteEditor').innerText;
    const lines = text.split('\n').filter(l => l.trim().startsWith('- '));
    lines.forEach(l => AppState.data.tasks.push({ id: 't_'+Date.now()+Math.random(), title: l.replace(/^- /,'').trim(), status: 'todo', bucket: 'next', dueAt: Date.now()+3*86400000, priority: 'P3', assignee: 'me' }));
    saveAll(); toast(`Extracted ${lines.length} tasks`);
  });

  // ---------- CRM ----------
  function renderCRM() {
    const cols = {
      lead: $('#crmLead'), qualified: $('#crmQualified'), proposal: $('#crmProposal'), won: $('#crmWon'), lost: $('#crmLost')
    };
    for (const k in cols) cols[k].innerHTML = '';
    AppState.data.deals.forEach(d => {
      const el = document.createElement('div'); el.className = 'deal-card'; el.draggable = true; el.setAttribute('data-id', d.id);
      el.innerHTML = `<strong>${escapeHTML(d.title)}</strong><div class="muted">$${d.value}</div>`;
      on(el, 'dragstart', e => e.dataTransfer.setData('text/plain', d.id));
      cols[d.stage]?.appendChild(el);
    });
    $$('.kanban.crm .kan-items').forEach(box => {
      on(box, 'dragover', e => e.preventDefault());
      on(box, 'drop', e => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        const deal = AppState.data.deals.find(x => x.id === id);
        deal.stage = box.parentElement.getAttribute('data-stage');
        saveAll(); renderCRM();
      });
    });
    on($('#btnNewDeal'), 'click', newDealPrompt);
  }
  function newDealPrompt() {
    const title = prompt('Deal title'); if (!title) return;
    const val = Number(prompt('Value (number)', '1000') || '0') || 0;
    AppState.data.deals.push({ id: 'd_' + Date.now(), title, value: val, stage: 'lead' });
    saveAll(); renderCRM();
  }

  // ---------- Sequences ----------
  on($('#btnNewSequence'), 'click', () => {
    $('#seqName').value = 'Untitled Sequence';
    $('#seqSteps').value = JSON.stringify([{ afterHours: 0, type:'email', template:'Hello!' }], null, 2);
  });
  on($('#btnSaveSequence'), 'click', e => {
    e.preventDefault();
    try {
      const name = $('#seqName').value.trim();
      const steps = JSON.parse($('#seqSteps').value || '[]');
      AppState.data.sequences.push({ id: 's_' + Date.now(), name, steps });
      saveAll(); renderSequencesList(); toast('Sequence saved');
    } catch { toast('Invalid steps JSON'); }
  });
  on($('#btnTestSequence'), 'click', e => {
    e.preventDefault();
    try {
      const steps = JSON.parse($('#seqSteps').value || '[]');
      const out = steps.map((s,i) => `Step ${i+1} after ${s.afterHours}h: ${s.type} → "${s.template?.slice(0,50)}"`).join('\n');
      $('#seqOut').textContent = out || 'No steps';
    } catch { $('#seqOut').textContent = 'Invalid JSON'; }
  });
  function renderSequencesList() {
    $('#seqList').innerHTML = AppState.data.sequences.map(s => `<li class="item"><strong>${escapeHTML(s.name)}</strong> • ${s.steps.length} steps</li>`).join('') || '<li class="item">No sequences</li>';
  }

  // ---------- Brand DNA ----------
  on($('#btnSaveDNA'), 'click', e => {
    e.preventDefault();
    AppState.data.brandDNA.mission = $('#dnaMission').value;
    AppState.data.brandDNA.sliders = { formal: +$('#dnaFormal').value, playful: +$('#dnaPlayful').value, enth: +$('#dnaEnth').value };
    AppState.data.brandDNA.banned = ($('#dnaBanned').value || '').split(',').map(s => s.trim()).filter(Boolean);
    saveAll(); toast('Brand DNA saved');
  });
  on($('#btnApplyDNA'), 'click', () => {
    const txt = $('#dnaSample').value;
    const { formal, playful, enth } = AppState.data.brandDNA.sliders;
    let out = txt;
    // Simple guardrail: remove banned words
    AppState.data.brandDNA.banned.forEach(b => { out = out.replace(new RegExp('\\b' + escapeRegex(b) + '\\b','gi'), '•••'); });
    // Style nudges (basic, deterministic rules — not AI)
    if (formal > 60) out = out.replace(/\bcan't\b/gi, 'cannot').replace(/\bwon't\b/gi, 'will not');
    if (playful > 60) out = out + ' 😊';
    if (enth > 60) out = out.replace(/\./g, '!');
    $('#dnaOut').textContent = out;
  });

  // ---------- Billing ----------
  function renderBilling() {
    $('#invoiceTable tbody').innerHTML = AppState.data.invoices.map(i => `<tr><td>${i.id}</td><td>${escapeHTML(i.client)}</td><td>$${i.amount}</td><td>${i.status}</td><td>${i.due}</td></tr>`).join('') || '<tr><td colspan="5">No invoices</td></tr>';
    $('#subsTable tbody').innerHTML = AppState.data.subs.map(s => `<tr><td>${escapeHTML(s.client)}</td><td>${escapeHTML(s.plan)}</td><td>${s.status}</td><td>${s.started}</td><td>${s.cancelAt||'—'}</td></tr>`).join('') || '<tr><td colspan="5">No subscriptions</td></tr>';
  }

  // ---------- Digital Twin ----------
  function renderTwin() {
    const grid = $('#deskGrid'); const cfg = AppState.data.desks;
    grid.style.setProperty('--cols', cfg.cols);
    grid.innerHTML = '';
    const total = cfg.total;
    for (let i=1;i<=total;i++) {
      const d = document.createElement('button'); d.className = 'desk'; d.setAttribute('role','gridcell'); d.textContent = i;
      if (cfg.bookings[i]?.user === 'me') d.classList.add('mine');
      if (cfg.bookings[i]) d.classList.add('booked');
      on(d, 'click', () => {
        if (cfg.bookings[i] && cfg.bookings[i].user !== 'me') { toast('Desk already booked'); return; }
        if (cfg.bookings[i]?.user === 'me') { delete cfg.bookings[i]; toast('Unbooked'); }
        else { cfg.bookings[i] = { user: 'me', date: new Date().toISOString().slice(0,10) }; toast('Booked'); }
        saveAll(); renderTwin();
      });
      grid.appendChild(d);
    }
  }

  // ---------- Reports ----------
  function renderReports() {
    drawBars($('#repVelocity'));
    drawBars($('#repUtilization'));
    drawBars($('#repInbox'));
  }
  function drawBars(box) {
    if (!box) return;
    box.innerHTML = '';
    const series = Array.from({length: 8}, () => Math.floor(Math.random()*90)+10);
    const max = Math.max(...series);
    series.forEach(v => {
      const bar = document.createElement('div'); bar.className = 'bar';
      bar.style.height = (Math.max(6, Math.round((v/max)*100))) + '%';
      box.appendChild(bar);
    });
  }

  // ---------- Admin (Theme / Settings) ----------
  on($('#btnSaveTheme'), 'click', e => {
    e.preventDefault();
    AppState.settings.theme.primary = $('#themePrimary').value || AppState.settings.theme.primary;
    AppState.settings.theme.wallpaper = $('#wallpaperSelect').value || 'none';
    AppState.settings.theme.density = $('#densitySelect').value || 'comfortable';
    AppState.settings.theme.highContrast = $('#highContrast').checked;
    saveAll(); applySettings(); toast('Theme saved');
  });

  // ---------- Billing / Invoices: overdue example rule trigger ----------
  function checkOverdueInvoices() {
    const today = new Date().toISOString().slice(0,10);
    const overdue = AppState.data.invoices.filter(i => i.status === 'Open' && i.due < today);
    if (overdue.length) {
      AppState.data.notifications.push({ id: 'n_' + Date.now(), type: 'billing', text: `${overdue.length} invoice(s) overdue`, ts: Date.now() });
      saveAll(); renderNotifications();
    }
  }

  // ---------- Utilities ----------
  function fmtDuration(sec) {
    const h = String(Math.floor(sec/3600)).padStart(2,'0');
    const m = String(Math.floor((sec%3600)/60)).padStart(2,'0');
    const s = String(sec%60).padStart(2,'0');
    return `${h}:${m}:${s}`;
  }
  function fmtDateTime(ts) {
    const d = new Date(ts);
    return d.toLocaleString();
  }
  function timeAgo(ts) {
    const s = Math.floor((Date.now()-ts)/1000);
    if (s < 60) return `${s}s ago`; const m = Math.floor(s/60);
    if (m < 60) return `${m}m ago`; const h = Math.floor(m/60);
    if (h < 24) return `${h}h ago`; const d = Math.floor(h/24);
    return `${d}d ago`;
  }
  function escapeHTML(s) { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Toasts
  function toast(msg) {
    const box = $('#toasts'); const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    box.appendChild(t); setTimeout(() => t.remove(), 2200);
  }

  // Sounds via WebAudio (no external files)
  let audioCtx;
  function playSound(kind='default') {
    if (AppState.user.presence === 'dnd') return;
    const settings = {
      'default': { freq: 990, dur: 0.08 },
      'priority': { freq: 440, dur: 0.16 },
      'dm': { freq: 660, dur: 0.12 },
      'mention': { freq: 820, dur: 0.12 },
      'taskDue': { freq: 520, dur: 0.18 }
    }[kind] || { freq: 990, dur: 0.08 };
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.type = 'sine'; osc.frequency.value = settings.freq;
    gain.gain.value = 0.02; osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); setTimeout(()=> osc.stop(), settings.dur*1000);
  }
  $$('#admin [data-sound]');
  $$('#/admin [data-sound]');
  $$('#/clients [data-sound]');
  $$('#/reports [data-sound]');
  $$('[data-sound]').forEach(b => on(b, 'click', () => playSound(b.getAttribute('data-sound'))));

  // Voice Recording
  function recordVoice(onReady) {
    if (!navigator.mediaDevices?.getUserMedia) { toast('Recording not supported'); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = e => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        onReady(url);
      };
      rec.start();
      toast('Recording… click to stop');
      const stop = () => { if (rec.state !== 'inactive') rec.stop(); stream.getTracks().forEach(t => t.stop()); document.removeEventListener('click', stop, true); };
      setTimeout(() => document.addEventListener('click', stop, true), 0);
    }).catch(() => toast('Microphone permission denied'));
  }

  // Keyboard shortcuts
  on(document, 'keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmdk(); }
    if (e.key === '/' && e.target === document.body) { e.preventDefault(); $('#globalSearch').focus(); }
    if (e.key.toLowerCase() === 'e' && $('.route.active [aria-label="Reply"]')) { e.preventDefault(); $('#replyBox')?.focus(); }
    if (e.key.toLowerCase() === 'n') { runQuickAction('newTask'); }
    if (e.key.toLowerCase() === 'g') {
      // Await second key
      let awaiting = true;
      const handler = (ev) => {
        if (!awaiting) return;
        awaiting = false;
        if (ev.key.toLowerCase() === 'i') location.hash = '#/inbox';
        if (ev.key.toLowerCase() === 't') location.hash = '#/workspace/my-tasks';
        document.removeEventListener('keydown', handler, true);
      };
      document.addEventListener('keydown', handler, true);
    }
  });

  // Sidebar keyboard toggle
  on(document, 'keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); $('#sidebar').classList.toggle('open'); }
    if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); toggleNotif(); }
  });

  // Navigation buttons inside content
  $$('[data-nav]').forEach(b => on(b, 'click', () => location.hash = b.getAttribute('data-nav')));

  // Initialization
  (function init() {
    // Apply settings
    applySettings();
    // Topbar
    initTopbar();
    // Role nav
    applyRole();
    // Sequences list
    renderSequencesList();
    // Billing check
    checkOverdueInvoices();
    // Initial route
    setRoute(location.hash || '#/');
  })();

})();
