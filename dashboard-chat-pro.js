// dashboard-chat-pro.js — full client-only chat, binds to your existing HTML, explicit mount/unmount, no auto-run
(function(){
  // ------------------- selectors -------------------
  const SEL = {
    section:    '#chat-root',
    list:       '#chatList',
    messages:   '#chatMessages',
    input:      '#chatInput',
    file:       '#chatFile',
    attachBtn:  '#chatAttach',
    recordBtn:  '#chatRecord',
    sendBtn:    '#chatSend',
    ctx:        '#chatContext',
    ctxClose:   '#btnCloseChatContext',
    ctxBody:    '#chatInfo'
  };

  // ------------------- state -------------------
  const state = {
    me: null, orgSlug: null,
    threads: [], messages: [],
    currentThread: null,
    ws: null, mounted: false, root: null,
    typingUsers: new Set()
  };

  // ------------------- api helpers -------------------
  const api = {
    get: (u) => fetch(u, { credentials:'include' }).then(r=>r.json()),
    post: (u,b) => fetch(u, {
      method:'POST', credentials:'include',
      headers:{ 'content-type':'application/json' },
      body: JSON.stringify(b)
    }).then(r=>r.json()),
    postForm: (u,fd)=> fetch(u, { method:'POST', credentials:'include', body: fd }).then(r=>r.json())
  };

  // ------------------- utils -------------------
  const esc = s => String(s??'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const fmtTime = iso => new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
  const toast = (msg,type='info')=>{
    let bar=document.querySelector('.toast-bar');
    if(!bar){bar=document.createElement('div');bar.className='toast-bar';document.body.appendChild(bar);}
    const t=document.createElement('div'); t.className=`toast ${type}`; t.textContent=msg; bar.appendChild(t);
    setTimeout(()=>{t.classList.add('out'); setTimeout(()=>t.remove(),300)},1800);
  };
  const fileUrl = (keyOrUrl)=> /^https?:\/\//i.test(keyOrUrl||'') ? keyOrUrl : (keyOrUrl ? `/api/cdn/${encodeURIComponent(keyOrUrl)}` : '');
  // ------------------- mount/unmount -------------------
  async function init(root){
    state.root = root;

    // who am I
    const me = await api.get('/api/me').catch(()=>null);
    if(!me?.auth){ toast('Please sign in','error'); return; }
    state.me = me.user; state.orgSlug = me.org?.slug || null;

    wireComposer();
    wireContext();
    await loadThreadsAndStructure();
    connectWS();
    state.mounted = true;
  }

  function cleanup(){
    try{ state.ws?.close?.(); }catch{}
    state.threads = []; state.messages = [];
    state.currentThread = null; state.typingUsers.clear();
    const msgs = q(SEL.messages); if (msgs) msgs.innerHTML='';
    const list = q(SEL.list); if (list) list.innerHTML='';
    state.mounted = false; state.root = null; state.ws = null;
  }

  // ------------------- DOM helper -------------------
  const q = sel => state.root?.querySelector(sel) || document.querySelector(sel);

  // ------------------- threads -------------------
  async function loadThreadsAndStructure(){
    const [threads, groups, depts, directory] = await Promise.all([
      api.get('/api/threads').catch(()=>[]),
      api.get('/api/groups').catch(()=>[]),
      api.get('/api/departments').catch(()=>[]),
      api.get('/api/directory').catch(()=>[])   // people visible to me
    ]);
    state.threads = Array.isArray(threads) ? threads : [];
    state.groupsById = new Map((groups||[]).map(g => [g.id, g]));
    state.deptsById  = new Map((depts||[]).map(d => [d.id, d]));
    state.userById   = new Map((directory||[]).map(u => [u.id, u]));
    renderThreadTree();
    // Auto-select something reasonable
    const first = state.threads[0];
    if (first) { state.currentThread = first; await loadMessages(first.id); }
  }

    function renderThreadTree(){
    const el = q(SEL.list); if (!el) return;
    el.innerHTML = '';

    if (!state.threads.length){
      el.innerHTML = `<div class="muted">You have not been added to any groups or departments.</div>`;
      return;
    }

    // Build: deptId -> (groupId -> [threads])
    const byDept = new Map();
    for (const t of state.threads){
      const dId = (t.department_id ?? 'none');
      const gId = (t.group_id ?? 'none');
      if (!byDept.has(dId)) byDept.set(dId, new Map());
      const gm = byDept.get(dId);
      if (!gm.has(gId)) gm.set(gId, []);
      gm.get(gId).push(t);
    }

    for (const [dId, groupsMap] of byDept.entries()){
      const d = dId !== 'none' ? state.deptsById.get(dId) : null;

      const section = document.createElement('div');
      section.className = 'dept-accordion';

      const legend = document.createElement('button');
      legend.type = 'button';
      legend.className = 'legend';
      legend.setAttribute('aria-expanded','false');
      legend.innerHTML = `
        <span>${esc(d ? (d.name || 'Department') : 'Uncategorized')}</span>
        <i class="bi bi-chevron-right" aria-hidden="true"></i>
      `;

      const container = document.createElement('div');
      container.className = 'group-list';
      container.hidden = true;

      legend.addEventListener('click', ()=>{
        const isOpen = container.hidden === false;
        // accordion: close others
        if (isOpen === false) {
          el.querySelectorAll('.group-list:not([hidden])').forEach(n => {
            n.hidden = true;
            const btn = n.previousElementSibling;
            if (btn?.setAttribute) btn.setAttribute('aria-expanded','false');
            btn?.querySelector('i')?.classList.remove('bi-chevron-down');
            btn?.querySelector('i')?.classList.add('bi-chevron-right');
          });
        }
        container.hidden = isOpen;
        legend.setAttribute('aria-expanded', String(!isOpen));
        legend.querySelector('i')?.classList.toggle('bi-chevron-right', isOpen);
        legend.querySelector('i')?.classList.toggle('bi-chevron-down', !isOpen);
      });

      for (const [gId, threads] of groupsMap.entries()){
        const g = gId !== 'none' ? state.groupsById.get(gId) : null;
        const name = g?.name || (threads[0]?.title ? threads[0].title : 'General');

        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML = `<span>${esc(name)}</span>`;
        item.addEventListener('click', async ()=>{
          const t = threads.find(x => x.group_id === (gId==='none'?null:gId)) || threads[0];
          state.currentThread = t;
          await loadMessages(t.id);
        });

        container.appendChild(item);
      }

      section.appendChild(legend);
      section.appendChild(container);
      el.appendChild(section);
    }
  }


  // ------------------- messages -------------------
  async function loadMessages(threadId){
    const res = await api.get(`/api/messages?thread_id=${encodeURIComponent(threadId)}&limit=100`).catch(()=>null);
    state.messages = Array.isArray(res?.messages) ? res.messages : (Array.isArray(res) ? res : []);
    renderMessages();
    if (state.messages.length){
      const last = state.messages[state.messages.length-1];
      await api.post('/api/messages.read', { thread_id: threadId, last_seen_at: last.created_at }).catch(()=>{});
    }
  }

  function renderMessages(){
    const box = q(SEL.messages); if (!box) return;
    box.innerHTML = '';
    state.messages.forEach(m=>{
      const mine = m.sender_id === state.me.id;

      const row = document.createElement('div');
      row.className = 'message-row' + (mine?' mine':'');
      row.style.display='flex';
      row.style.justifyContent = mine ? 'flex-end' : 'flex-start';
      row.style.margin = '6px 0';

      // Avatar (clickable to open the right panel)
      const avatar = document.createElement('button');
      avatar.className = 'avatar-btn';
      avatar.style.width = '28px';
      avatar.style.height = '28px';
      avatar.style.borderRadius = '50%';
      avatar.style.border = '0';
      avatar.style.marginRight = '8px';
      avatar.style.background = '#e5e7eb';
      const user = state.userById.get(m.sender_id);
      const initials = (user?.display_name || user?.name || user?.email || '?')
        .split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase();
      avatar.textContent = initials;
      avatar.title = (user?.display_name || user?.name || user?.email || 'User');
      avatar.addEventListener('click', ()=> openUserCard({
        name: user?.display_name || user?.name || '',
        email: user?.email || '',
        role:  user?.role || ''
      }));

      const bubble = document.createElement('div');
      bubble.className = 'bubble' + (mine?' me':'');
      bubble.style.maxWidth='72%';
      bubble.style.background = mine ? '#e0f2fe' : '#f1f5f9';
      bubble.style.padding = '10px 12px';
      bubble.style.borderRadius = '14px';
      bubble.style.position = 'relative';
      bubble.style.wordBreak = 'break-word';

      let inner='';
      if (m.kind==='text') {
        const text = (m.body && typeof m.body==='object' ? m.body.text : null) ?? (typeof m.content==='string' ? m.content : '');
        inner = esc(text);
      } else if (m.kind==='voice') {
        inner = `<audio controls src="${fileUrl(m.media_url)}"></audio>`;
      } else if (m.kind==='file') {
        const name = (m.body?.name) || 'attachment';
        inner = `<a href="${fileUrl(m.media_url)}" target="_blank" rel="noopener">📎 ${esc(name)}</a>`;
      } else {
        inner = esc(m.kind);
      }

      bubble.innerHTML = `${inner}<time style="position:absolute;bottom:-16px;right:8px;color:#94a3b8;font-size:11px">${fmtTime(m.created_at)}</time>`;
      if (!mine) row.appendChild(avatar);
      row.appendChild(bubble);      box.appendChild(row);
    });
    box.scrollTop = box.scrollHeight;
  }

  // ------------------- composer -------------------
  function wireComposer(){
    const input = q(SEL.input);
    const sendBtn = q(SEL.sendBtn);
    const attachBtn = q(SEL.attachBtn);
    const file = q(SEL.file);
    const recBtn = q(SEL.recordBtn);

    sendBtn.addEventListener('click', sendText);
    input.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendText(); }});
    attachBtn.addEventListener('click', ()=> file.click());
    file.addEventListener('change', sendFile);

    // voice note
    let mediaRec=null, chunks=[];
    async function startRec(){
      try{
        const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
        mediaRec = new MediaRecorder(stream, { mimeType:'audio/webm' });
        chunks=[];
        mediaRec.ondataavailable = e=>{ if(e.data.size>0) chunks.push(e.data); };
        mediaRec.onstop = async ()=>{
          const blob = new Blob(chunks, { type:'audio/webm' });
          await uploadBlob(blob, 'voice');
        };
        mediaRec.start(); toast('Recording…','info');
      }catch{ toast('Mic error','error'); }
    }
    function stopRec(){ try{ if(mediaRec && mediaRec.state!=='inactive') mediaRec.stop(); toast('Processing…','info'); }catch{} }

    recBtn.addEventListener('pointerdown', startRec);
    recBtn.addEventListener('pointerup', stopRec);
    recBtn.addEventListener('pointerleave', stopRec);
  }

  async function sendText(){
    if (!state.currentThread) { toast('Pick a conversation','info'); return; }
    const input = q(SEL.input);
    const text = (input.value || '').trim(); if (!text) return;

    // Optimistic message
    const client_id = crypto.randomUUID();
    const pending = {
      id: client_id, client_id,
      thread_id: state.currentThread.id,
      sender_id: state.me.id,
      kind: 'text',
      body: { text },
      created_at: new Date().toISOString(),
      __pending: true
    };
    state.messages.push(pending);
    renderMessages();

    input.value = '';
    const payload = {
      thread_id: pending.thread_id,
      kind: 'text',
      body: { text },      // server expects body.text
      content: text,       // also send content for compatibility
      client_id            // idempotency
    };

    // timeout + clear error messaging
    const controller = new AbortController();
    const t = setTimeout(()=>controller.abort(), 10000);
    let res;
    try {
      res = await fetch('/api/messages', {
        method:'POST',
        credentials:'include',
        headers:{'content-type':'application/json'},
        body: JSON.stringify(payload),
        signal: controller.signal
      }).then(r=>r.json());
    } catch (e) {
      res = { error: 'network_error' };
    } finally { clearTimeout(t); }

    // Reconcile
    const idx = state.messages.findIndex(m => m.id === client_id);
    if (res?.id) {
      // confirmed
      const merged = { ...state.messages[idx], id: res.id, __pending:false, created_at: res.created_at || pending.created_at };
      state.messages.splice(idx, 1, merged);
      renderMessages();
    } else {
      // surface exact cause from API if present
      const reason = res?.error || 'send_failed';
      const failed = { ...state.messages[idx], __pending:false, __failed:true, __reason: reason };
      state.messages.splice(idx, 1, failed);
      renderMessages();
      toast(
        reason === 'forbidden' ? 'You are not a member of this group/department.' :
        reason === 'unauthorized' ? 'Please sign in again.' :
        reason, 'error'
      );
    }
  }

  async function sendFile(e){
    if (!state.currentThread) { toast('Pick a conversation','info'); return; }
    const f = e.target?.files?.[0]; if (!f) return;
    toast('Uploading…','info');
    const fd = new FormData(); fd.append('file', f);
    const up = await api.postForm('/api/uploads/message', fd).catch(()=>null);
    if (!up?.url) return toast('Upload failed','error');

    const kind = f.type?.startsWith('audio/') ? 'voice' : 'file';
    const res = await api.post('/api/messages', {
      thread_id: state.currentThread.id,
      kind,
      media_url: up.url,
      body: kind==='file' ? { name: f.name, size: f.size, type: f.type } : {},
      content: f.name
    }).catch(()=>null);
    if (res?.id || res?.ok) { toast('Sent','success'); await loadMessages(state.currentThread.id); e.target.value=''; }
    else toast('Failed','error');
  }

  async function uploadBlob(blob, kind){
    if (!state.currentThread) { toast('Pick a conversation','info'); return; }
    const fd = new FormData(); fd.append('file', new File([blob], `${kind}-${Date.now()}.webm`, { type: blob.type || 'audio/webm' }));
    const up = await api.postForm('/api/uploads/message', fd).catch(()=>null);
    if (!up?.url) return toast('Upload failed','error');
    const res = await api.post('/api/messages', {
      thread_id: state.currentThread.id,
      kind, media_url: up.url, content: `${kind} message`
    }).catch(()=>null);
    if (res?.id || res?.ok) { toast('Sent','success'); await loadMessages(state.currentThread.id); }
  }

  // ------------------- right context panel -------------------
  function wireContext(){
    const ctx = q(SEL.ctx), closeBtn = q(SEL.ctxClose);
    if (closeBtn) closeBtn.addEventListener('click', ()=> ctx.setAttribute('hidden',''));
  }
  function openUserCard(user){
    const ctx = q(SEL.ctx), body = q(SEL.ctxBody);
    body.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;margin:8px 0">
        <div style="width:36px;height:36px;border-radius:50%;background:#e5e7eb"></div>
        <div>
          <div style="font-weight:600">${esc(user.display_name||user.name||'User')}</div>
          <div class="muted" style="font-size:.9em">${esc(user.email||'')}</div>
        </div>
      </div>
      <div class="row" style="gap:8px;margin-top:8px">
        <button class="icon-btn" title="Text">📩</button>
        <button class="icon-btn" title="Call">📞</button>
        <button class="icon-btn" title="Favorite">⭐</button>
      </div>
    `;
    ctx.removeAttribute('hidden');
  }
  window.openUserCard = openUserCard; // optional hook

  // ------------------- websockets (optional) -------------------
  function connectWS(){
    const base = window.ORG_WS_BASE; if (!base) return;
    try{
      const ws = new WebSocket(base.replace(/^http/,'ws') + `/ws/org/${encodeURIComponent(state.orgSlug||'general')}`);
      state.ws = ws;
      ws.onmessage = (ev)=>{
        try{
          const msg = JSON.parse(ev.data);
          if (msg.type==='message.new' && state.currentThread && msg.thread_id===state.currentThread.id){
            state.messages.push({ id: msg.id, sender_id: msg.sender_id, kind: msg.kind, body: msg.body, content: msg.content, media_url: msg.media_url, created_at: msg.created_at });
            renderMessages();
          }
        }catch{}
      };
    }catch{}
  }
  function sendTyping(on){
    if (!state.ws || !state.currentThread) return;
    try{ state.ws.send(JSON.stringify({ type:'typing', thread_id: state.currentThread.id, user_id: state.me.id, on })); }catch{}
  }

  // ------------------- public API -------------------
  window.ChatPro = {
    mount(selector = SEL.section){
      if (window.__CHAT_PRO_MOUNTED__) return;
      const root = document.querySelector(selector);
      if (!root) return;
      window.__CHAT_PRO_MOUNTED__ = true;
      init(root);
    },
    unmount(){
      if (!window.__CHAT_PRO_MOUNTED__) return;
      cleanup();
      window.__CHAT_PRO_MOUNTED__ = false;
    }
  };
})();
