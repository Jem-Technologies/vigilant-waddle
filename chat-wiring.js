// chat-wiring.js  (drop-in)
(() => {
  const qs  = sel => document.querySelector(sel);
  const qsa = sel => Array.from(document.querySelectorAll(sel));

  const elRoot       = qs('#chat-root');
  const elList       = qs('#chatList');
  const elMsgs       = qs('#chatMessages');
  const elInput      = qs('#chatInput');
  const elFile       = qs('#chatFile');
  const elAttachBtn  = qs('#chatAttach');
  const elRecordBtn  = qs('#chatRecord');
  const elSendBtn    = qs('#chatSend');
  const contextPanel = qs('#contextPanel');
  const contextBody  = qs('#contextContent');
  const btnCloseCtx  = qs('#btnCloseContext');

  const state = {
    me: null,
    org: null,
    departments: [],
    groups: [],
    threads: [],
    messages: [],
    currentThreadId: null,
    // NEW
    userMap: {},  // id -> { id, name, display_name, avatar_url, email, username, role, nickname, use_nickname }
  };

  const fmtTime = iso => new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
  const esc = s => String(s||'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const toast = (msg,type='info')=>{
    let bar = qs('.toast-bar'); if(!bar){bar=document.createElement('div');bar.className='toast-bar';document.body.appendChild(bar);}
    const t = document.createElement('div'); t.className=`toast ${type}`; t.textContent=msg; bar.appendChild(t);
    setTimeout(()=>{t.classList.add('out'); setTimeout(()=>t.remove(), 300)}, 1800);
  };
  const mediaUrl = (key) => `/cdn/${encodeURIComponent(key)}`;

  // Public hook so Admin card can refresh lists after creating depts/groups
  window.refreshChatLists = async () => {
    await loadDepartments();
    await loadGroups();
    await loadThreads(); // if you show a combined list
    renderThreadList();
  };

  // Boot
  (async function init(){
    const me = await fetch("/api/me", { credentials:"include" }).then(r=>r.json()).catch(()=>null);
    if (!me?.auth) { location.href="/index.html#login"; return; }
    state.me = me.user;  // { id, name, username, email, role }
    state.org = me.org;  // { id, slug, name }

    // NEW: load people I can see (same depts/groups) for display_name & avatars
    await loadDirectory();

    await window.refreshChatLists();

    wireComposer();
    wireContext();
  })();

  async function loadDirectory(){
    const r = await fetch("/api/directory", { credentials:"include" });
    const arr = await r.json().catch(()=>[]);
    state.userMap = Object.fromEntries(arr.map(u => [u.id, u]));
    // include self too (so display_name works for my outgoing bubbles)
    state.userMap[state.me.id] = {
      id: state.me.id, name: state.me.name, username: state.me.username, email: state.me.email,
      avatar_url: state.me.avatar_url || null,
      nickname: state.me.nickname || null,
      use_nickname: !!state.me.use_nickname,
      role: state.me.role,
      display_name: (state.me.use_nickname && state.me.nickname) ? state.me.nickname : state.me.name
    };
  }

  async function loadDepartments(){
    const r = await fetch("/api/departments", { credentials:"include" });
    state.departments = await r.json().catch(()=>[]);
  }
  async function loadGroups(){
    const r = await fetch("/api/groups", { credentials:"include" });
    state.groups = await r.json().catch(()=>[]);
  }
  async function loadThreads(){
    const r = await fetch("/api/threads", { credentials:"include" });
    state.threads = await r.json().catch(()=>[]);
  }

  function renderThreadList(){
    if (!elList) return;
    // (use your existing rendering for threads; omitted for brevity)
    // Ensure selecting a thread sets state.currentThreadId & calls loadMessages(threadId)
  }

  async function loadMessages(threadId){
    state.currentThreadId = threadId;
    const r = await fetch(`/api/messages?thread_id=${encodeURIComponent(threadId)}`, { credentials:"include" });
    state.messages = await r.json().catch(()=>[]);
    renderMessages();
  }

  function renderMessages(){
    if (!elMsgs) return;
    elMsgs.innerHTML = "";

    for (const m of state.messages) {
      const mine = m.sender_id === state.me.id;
      const u = state.userMap[m.sender_id] || null;

      const row = document.createElement('div');
      row.className = 'msg-row' + (mine ? ' mine' : '');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'flex-start';
      row.style.justifyContent = mine ? 'flex-end' : 'flex-start';

      // Avatar first (always)
      const av = document.createElement('img');
      av.className = 'avatar';
      av.width = 32; av.height = 32;
      av.alt = u?.display_name || u?.name || 'User';
      if (u?.avatar_url) av.src = mediaUrl(u.avatar_url);
      else { av.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; av.style.background = '#ccc'; av.style.borderRadius='50%'; }

      av.addEventListener('click', () => openProfilePanel(u?.id));
      row.appendChild(av);

      // Bubble with display name + message
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble' + (mine ? ' mine' : '');
      bubble.style.maxWidth = 'min(70ch, 85%)';
      bubble.innerHTML = `
        <div class="msg-head" style="font-size:.8rem; opacity:.7; margin-bottom:2px;">
          ${esc(u?.display_name || u?.name || 'Unknown')}
          <span class="msg-time" style="float:right; opacity:.6">${fmtTime(m.created_at)}</span>
        </div>
        <div class="msg-body">${renderMessageBody(m)}</div>
      `;
      row.appendChild(bubble);

      elMsgs.appendChild(row);
    }
    elMsgs.scrollTop = elMsgs.scrollHeight;
  }

  function renderMessageBody(m){
    if (m.kind === 'file' && m.file_key) {
      const url = mediaUrl(m.file_key);
      const safeName = esc(m.file_name || 'file');
      return `<a href="${url}" target="_blank" rel="noopener">${safeName}</a>`;
    }
    // text and others
    return esc(m.content || "");
  }

  function wireComposer(){
    if (elSendBtn) elSendBtn.addEventListener('click', sendMessage);
    if (elInput) elInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); }});
    // Attach/file handlers unchanged (use your existing upload flow)
  }

  async function sendMessage(){
    const text = (elInput?.value || "").trim();
    if (!text || !state.currentThreadId) return;
    const payload = { thread_id: state.currentThreadId, kind: "text", content: text };
    const r = await fetch("/api/messages", {
      method: "POST", credentials:"include",
      headers: { "content-type":"application/json" },
      body: JSON.stringify(payload)
    });
    if (!r.ok) { toast("Send failed","error"); return; }
    elInput.value = "";
    // reload
    await loadMessages(state.currentThreadId);
  }

  function wireContext(){
    btnCloseCtx?.addEventListener('click', () => contextPanel?.setAttribute('hidden',''));
  }

  async function openProfilePanel(userId){
    if (!userId) return;
    const u = state.userMap[userId];
    if (!u) return;

    contextBody.innerHTML = `
      <div style="display:flex; gap:12px; align-items:center; margin-bottom:8px;">
        <img class="avatar" width="40" height="40" alt="${esc(u.display_name)}" src="${u.avatar_url ? mediaUrl(u.avatar_url) : ''}" style="border-radius:50%; background:#ddd"/>
        <div>
          <div style="font-weight:600">${esc(u.display_name || u.name)}</div>
          <div class="muted">${esc(u.email || '')}</div>
        </div>
      </div>
      <div class="grid-2">
        <div><strong>Username</strong><br>${esc(u.username || '—')}</div>
        <div><strong>Role</strong><br>${esc(u.role || '—')}</div>
        <div><strong>Nickname</strong><br>${u.nickname ? esc(u.nickname) : '<span class="muted">Not set</span>'}</div>
      </div>
      <div style="margin-top:10px; display:flex; gap:8px;">
        <button class="icon-btn" title="Send text">📩</button>
        <button class="icon-btn" title="Call">📞</button>
        <button class="icon-btn" title="Favorite">⭐</button>
      </div>
    `;
    contextPanel?.removeAttribute('hidden');
  }

  // Expose for other scripts to open profile programmatically
  window.openUserProfile = openProfilePanel;

})();
