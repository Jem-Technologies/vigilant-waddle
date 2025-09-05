// === Chat wiring for your existing DOM ===
// Uses your new APIs: /api/departments, /api/groups, /api/threads, /api/messages, /api/uploads/message
// No realtime required. Optional TODOs noted inline.

(() => {
  // ---- DOM hooks (your IDs/classes) ----
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
  const elRightPane  = qs('#chatContext');
  const elCloseRight = qs('#btnCloseChatContext');

  if (!elRoot) return; // not on this page

  // ---- Small helpers ----
  const api = {
    get:  (u) => fetch(u, { credentials:'include' }).then(r=>r.json()),
    post: (u,b) => fetch(u, { method:'POST', credentials:'include', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }).then(r=>r.json()),
  };
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const fmtTime = iso => new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
  const esc = s => String(s||'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const toast = (msg,type='info')=>{
    let bar = qs('.toast-bar'); if(!bar){bar=document.createElement('div');bar.className='toast-bar';document.body.appendChild(bar);}
    const t = document.createElement('div'); t.className=`toast ${type}`; t.textContent=msg; bar.appendChild(t);
    setTimeout(()=>{t.classList.add('out'); setTimeout(()=>t.remove(), 300)}, 1800);
  };
  // TODO: adapt if you proxy R2 differently
  const mediaUrl = (key) => `/cdn/${encodeURIComponent(key)}`;

  // ---- State ----
  const state = {
    me: null, org: null,
    departments: [], groups: [],
    // Conversations list = flattened threads from (departments + groups)
    conversations: [],         // [{id,title, parentType:'dep'|'grp', parentName, parentId, created_at}]
    current: null,             // selected conversation { ... }
    messages: [],              // last loaded messages
    recorder: null, recStream: null, recChunks: [],
  };

  // ---- Boot ----
  document.addEventListener('DOMContentLoaded', init);
  async function init(){
    // Fetch session identity (id/orgSlug for "me" styling or future WS)
    const me = await api.get('/api/me').catch(()=>null);
    if (!me?.auth) { toast('Please sign in','error'); return; }
    state.me = me.user; state.org = me.org;

    // Load departments/groups, then build conversation list (threads)
    await loadDepartments();
    await loadGroups();
    await buildConversations();

    // Wire UI events
    elAttachBtn.addEventListener('click', ()=> elFile.click());
    elFile.addEventListener('change', handleAttach);
    elSendBtn.addEventListener('click', sendText);
    elInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }});
    wireRecorder();
    if (elCloseRight) elCloseRight.addEventListener('click', ()=> elRightPane.hidden = true);
  }

  // ---- Data loaders ----
  async function loadDepartments(){
    const r = await api.get('/api/departments');
    state.departments = Array.isArray(r)? r : [];
  }
  async function loadGroups(){
    const r = await api.get('/api/groups');
    state.groups = Array.isArray(r)? r : [];
  }

  async function buildConversations(){
    // Flatten threads from each department and group into one "Conversations" list
    const conv = [];

    // Departments
    for (const d of state.departments){
      const t = await api.get(`/api/threads?department_id=${encodeURIComponent(d.id)}`).catch(()=>[]);
      (Array.isArray(t)? t : []).forEach(th=>{
        conv.push({
          id: th.id, title: th.title || `#${d.name}`,
          parentType: 'dep', parentName: d.name, parentId: d.id,
          created_at: th.created_at
        });
      });
    }

    // Groups
    for (const g of state.groups){
      const t = await api.get(`/api/threads?group_id=${encodeURIComponent(g.id)}`).catch(()=>[]);
      (Array.isArray(t)? t : []).forEach(th=>{
        conv.push({
          id: th.id, title: th.title || `#${g.name}`,
          parentType: 'grp', parentName: g.name, parentId: g.id,
          created_at: th.created_at
        });
      });
    }

    // Sort newest first
    conv.sort((a,b)=> new Date(b.created_at) - new Date(a.created_at));
    state.conversations = conv;

    renderConversationList();
    if (!state.current && state.conversations.length){
      selectConversation(state.conversations[0].id);
    }
  }

  function renderConversationList(){
    elList.innerHTML = '';
    if (!state.conversations.length){
      elList.innerHTML = `<div class="empty">No conversations yet</div>`;
      return;
    }
    state.conversations.forEach(c=>{
      const div = document.createElement('div');
      div.className = 'item selectable' + (state.current?.id===c.id ? ' active' : '');
      div.innerHTML = `
        <div class="title">${esc(c.title)}</div>
        <div class="meta"><small>${esc(c.parentType==='dep' ? 'Dept' : 'Group')}: ${esc(c.parentName)}</small></div>
      `;
      div.addEventListener('click', ()=> selectConversation(c.id));
      elList.appendChild(div);
    });
  }

  async function selectConversation(threadId){
    state.current = state.conversations.find(c=>c.id===threadId) || null;
    renderConversationList();
    if (!state.current) { elMsgs.innerHTML = ''; return; }
    await loadMessages(threadId);
  }

  async function loadMessages(threadId){
    const r = await api.get(`/api/messages?thread_id=${encodeURIComponent(threadId)}&limit=100`);
    state.messages = Array.isArray(r?.messages) ? r.messages : [];
    renderMessages();
    // mark as read (optional endpoint)
    if (state.messages.length){
      const last = state.messages[state.messages.length-1];
      api.post('/api/messages.read', { thread_id: threadId, last_seen_at: last.created_at }).catch(()=>{});
    }
  }

  // ---- Rendering ----
  function renderMessages(){
    elMsgs.innerHTML = '';
    if (!state.current) return;

    state.messages.forEach(m=>{
      const mine = !!(state.me && m.sender_id === state.me.id);
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble' + (mine ? ' mine' : '');
      bubble.style.margin = '8px 10px';
      bubble.style.maxWidth = '75%';
      bubble.style.padding = '8px 10px';
      bubble.style.borderRadius = '12px';
      bubble.style.background = mine ? '#e0f2fe' : '#f3f4f6';
      bubble.style.alignSelf = mine ? 'flex-end' : 'flex-start';
      bubble.style.position = 'relative';

      let content = '';
      if (m.kind === 'text'){
        const text = (m.body && typeof m.body === 'object') ? m.body.text : m.body;
        content = esc(text);
      } else if (m.kind === 'voice'){
        content = `<audio controls src="${mediaUrl(m.media_url)}"></audio>`;
      } else if (m.kind === 'file'){
        const name = (m.body && m.body.name) ? m.body.name : 'attachment';
        content = `<a href="${mediaUrl(m.media_url)}" target="_blank">📎 ${esc(name)}</a>`;
      } else {
        content = esc(m.kind);
      }

      bubble.innerHTML = `${content}<small style="position:absolute;right:8px;bottom:-16px;color:#94a3b8">${fmtTime(m.created_at)}</small>`;
      elMsgs.appendChild(bubble);
    });

    // scroll to bottom
    elMsgs.scrollTop = elMsgs.scrollHeight;
  }

  // ---- Senders ----
  async function sendText(){
    if (!state.current) return toast('Pick a conversation', 'info');
    const text = elInput.value.trim();
    if (!text) return;
    try{
      elSendBtn.disabled = true;
      const res = await api.post('/api/messages', { thread_id: state.current.id, kind:'text', body:{ text }});
      if (res?.id){
        elInput.value = '';
        await loadMessages(state.current.id);
      } else {
        toast('Failed to send','error');
      }
    } finally {
      elSendBtn.disabled = false;
    }
  }

  async function handleAttach(ev){
    if (!state.current) { ev.target.value=''; return toast('Pick a conversation','info'); }
    const f = ev.target.files?.[0];
    if (!f) return;
    try{
      toast('Uploading…','info');
      const fd = new FormData();
      fd.append('file', f);
      const up = await fetch('/api/uploads/message', { method:'POST', credentials:'include', body: fd }).then(r=>r.json());
      if (!up?.url) return toast('Upload failed','error');

      const kind = f.type.startsWith('audio/') ? 'voice' : 'file';
      const body = kind==='file' ? { name: f.name, size: f.size, type: f.type } : {};
      const res = await api.post('/api/messages', { thread_id: state.current.id, kind, body, media_url: up.url });
      if (res?.id){
        toast('Sent','success');
        await loadMessages(state.current.id);
      } else {
        toast('Failed to send','error');
      }
    } finally {
      ev.target.value = '';
    }
  }

  // ---- Voice (press/release mic button) ----
  function wireRecorder(){
    if (!elRecordBtn) return;
    elRecordBtn.addEventListener('mousedown', startRec);
    elRecordBtn.addEventListener('mouseup', stopRec);
    elRecordBtn.addEventListener('mouseleave', stopRec);
    elRecordBtn.addEventListener('touchstart', (e)=>{ e.preventDefault(); startRec(); }, {passive:false});
    elRecordBtn.addEventListener('touchend', (e)=>{ e.preventDefault(); stopRec(); }, {passive:false});
  }
  async function startRec(){
    if (!state.current) return toast('Pick a conversation','info');
    try{
      state.recStream = await navigator.mediaDevices.getUserMedia({ audio:true });
      state.recorder = new MediaRecorder(state.recStream, { mimeType: 'audio/webm' });
      state.recChunks = [];
      state.recorder.ondataavailable = e => { if (e.data.size>0) state.recChunks.push(e.data); };
      state.recorder.onstop = async () => {
        const blob = new Blob(state.recChunks, { type:'audio/webm' });
        await uploadVoiceBlob(blob);
        // cleanup
        state.recStream.getTracks().forEach(t=>t.stop());
        state.recStream = null; state.recorder = null; state.recChunks = [];
      };
      state.recorder.start();
      toast('Recording…','info');
    } catch (e){
      toast('Mic not available','error');
    }
  }
  async function stopRec(){
    if (state.recorder && state.recorder.state !== 'inactive'){
      toast('Processing…','info');
      state.recorder.stop();
    }
  }
  async function uploadVoiceBlob(blob){
    const fd = new FormData();
    fd.append('file', new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || 'audio/webm' }));
    const up = await fetch('/api/uploads/message', { method:'POST', credentials:'include', body: fd }).then(r=>r.json());
    if (!up?.url) return toast('Upload failed','error');
    const res = await api.post('/api/messages', { thread_id: state.current.id, kind:'voice', media_url: up.url });
    if (res?.id){ await loadMessages(state.current.id); }
  }

  // ---- (Optional) Show/hide right panel with member info later ----
  // You already have #chatContext and a close button. You can fill #chatInfo
  // by calling GET /api/directory and filtering to members who share the
  // parent department/group of the selected thread.

})();
