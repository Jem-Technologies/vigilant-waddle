// =============================================================
// DASHBOARD CHAT PRO – Drop‑in UI + minimal server endpoints
// Vanilla JS front‑end + a couple of Pages Functions to support uploads and reads
// Also includes an UPDATED Durable Object OrgHub that relays client typing events
// =============================================================
// FILES IN THIS SNIPPET (copy each to the matching path in your repo):
//
// 1) functions/api/uploads/message.js        ← NEW (R2 message/file uploads)
// 2) functions/api/messages.read.js          ← NEW (mark thread messages as read)
// 3) functions/_lib/wsClientEvents.d.ts      ← (optional) typings for events
// 4) worker/OrgHub.ts                        ← UPDATED Durable Object (relay typing)
// 5) /dashboard-chat-pro.js                  ← NEW front-end drop‑in
//
// Prereqs:
// - D1 bound as DB; R2 bound as BUCKET (done earlier)
// - d1_migration_chat.sql applied (threads/messages tables exist)
// - /api/me exists (your repo already has it) – used to fetch user + orgSlug
// - Optional: Deploy OrgHub Worker and set window.ORG_WS_BASE = "https://<worker>"
// =============================================================

/* =====================================================================
   1) functions/api/uploads/message.js  (NEW)
   Upload arbitrary chat attachments (images, audio, docs) to R2 and return URL.
   Client then posts /api/messages with kind='file' or 'voice' and the media_url.
   ===================================================================== */

export async function onRequestPost({ request, env }){
  const { getAuthed, json } = await import("../../_lib/auth.js");
  const { readUpload } = await import("../../_lib/uploads.js");
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error: "unauthorized" }, 401);
  if (!env.BUCKET) return json({ error: "R2 BUCKET not bound" }, 500);

  const { file, filename, contentType } = await readUpload(request);
  if (!file) return json({ error: "missing file" }, 400);

  const now = Date.now();
  const safeName = (filename || "upload.bin").replace(/[^a-zA-Z0-9_.-]+/g, "-");
  const key = `${auth.orgSlug}/threads/${now}-${crypto.randomUUID()}-${safeName}`;

  await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: contentType || "application/octet-stream" } });
  return json({ url: key, contentType: contentType || "application/octet-stream" });
}

/* =====================================================================
   2) functions/api/messages.read.js  (NEW)
   Mark messages in a thread as "read" by current user. Stores a high‑water mark.
   UI can compute "unread" by comparing to latest message timestamp.
   ===================================================================== */

export async function onRequestPost({ request, env }){
  const { getAuthed, json } = await import("../_lib/auth.js");
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error: "unauthorized" }, 401);

  const body = await request.json().catch(()=>null);
  const threadId = body?.thread_id;
  const lastSeenIso = body?.last_seen_at; // ISO timestamp of last message visible
  if (!threadId || !lastSeenIso) return json({ error: "thread_id and last_seen_at required" }, 400);

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS message_reads (
      user_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (user_id, thread_id)
    );
  `).run();

  await env.DB.prepare(`
    INSERT INTO message_reads (user_id, thread_id, last_seen_at)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(user_id, thread_id) DO UPDATE SET last_seen_at=excluded.last_seen_at
  `).bind(auth.userId, threadId, lastSeenIso).run();

  return json({ ok: true });
}

/* =====================================================================
   3) functions/_lib/wsClientEvents.d.ts  (optional, for your editor)
   ===================================================================== */

export type OrgHubClientIn =
  | { type: 'ping' }
  | { type: 'typing'; thread_id: string; user_id: string; on: boolean };

export type OrgHubClientOut =
  | { type: 'connected'; socketId: string; ts: number }
  | { type: 'pong'; ts: number }
  | { type: 'typing'; thread_id: string; user_id: string; on: boolean }
  | { type: 'message.new'; id: string; thread_id: string; kind: string; body?: any; media_url?: string; created_at: string; sender_id: string };

/* =====================================================================
   4) worker/OrgHub.ts  (UPDATED DO that relays client typing events)
   If you already deployed the earlier OrgHub, replace its class with this one.
   ===================================================================== */

export class OrgHub {
  state; env; sockets = new Map();
  constructor(state, env){ this.state = state; this.env = env; }
  async fetch(req){
    const url = new URL(req.url);
    if (url.pathname === "/connect"){
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this._accept(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/broadcast" && req.method === "POST"){
      const payload = await req.json();
      this._fanout(payload);
      return new Response(JSON.stringify({ delivered: this.sockets.size }), { headers:{"content-type":"application/json"} });
    }
    return new Response(JSON.stringify({ error:"not_found" }), { status:404 });
  }
  _accept(ws){
    const id = crypto.randomUUID();
    ws.accept();
    this.sockets.set(id, ws);
    ws.addEventListener('message', (ev)=>{
      try{
        const data = JSON.parse(String(ev.data||'{}'));
        if (data?.type === 'ping') ws.send(JSON.stringify({ type:'pong', ts: Date.now() }));
        else if (data?.type === 'typing') this._fanout({ type:'typing', thread_id: data.thread_id, user_id: data.user_id, on: !!data.on });
      }catch{}
    });
    const cleanup = ()=>{ try{ws.close()}catch{}; this.sockets.delete(id); };
    ws.addEventListener('close', cleanup); ws.addEventListener('error', cleanup);
    ws.send(JSON.stringify({ type:'connected', socketId:id, ts:Date.now() }));
  }
  _fanout(obj){
    const msg = JSON.stringify(obj);
    for (const ws of this.sockets.values()) try{ ws.send(msg); }catch{}
  }
}

/* =====================================================================
   5) /dashboard-chat-pro.js  (DROP‑IN UI)
   Features: unread count, typing indicator, image/audio/doc upload, voice notes (MediaRecorder), toasts
   ===================================================================== */

(function(){
  const rootId = 'chat-root';
  const el = () => document.getElementById(rootId);

  const api = {
    get: (u) => fetch(u, { credentials:'include' }).then(r=>r.json()),
    post: (u,b) => fetch(u, { method:'POST', credentials:'include', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }).then(r=>r.json()),
  };

  const state = {
    me: null, orgSlug: null,
    departments: [], groups: [],
    threads: [], messages: [],
    currentDepartment: null, currentGroup: null, currentThread: null,
    typingUsers: new Set(),
    ws: null,
  };

  function toast(msg, type='info'){
    let bar = document.querySelector('.toast-bar');
    if (!bar){ bar = document.createElement('div'); bar.className='toast-bar'; document.body.appendChild(bar); }
    const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg; bar.appendChild(t);
    setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(), 300); }, 1800);
  }

  function layout(){
    const r = el(); if (!r) return;
    r.innerHTML = `
    <style>
      #${rootId}{display:grid;grid-template-columns:260px 1fr;gap:12px;height:76vh}
      .pane{border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
      .pane h3{margin:0;padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#fafafa;font-size:14px}
      .list{overflow:auto}
      .item{padding:10px 12px;cursor:pointer;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;gap:8px}
      .item:hover{background:#f8fafc}
      .item.active{background:#eef2ff}
      .badge{background:#ef4444;color:#fff;border-radius:9999px;padding:0 8px;font-size:11px;min-width:18px;text-align:center}
      .messages{flex:1;overflow:auto;background:#fff}
      .bubble{max-width:72%;margin:10px 12px;padding:10px 12px;border-radius:14px;background:#f1f5f9;position:relative;line-height:1.35}
      .bubble.me{background:#e0f2fe;margin-left:auto}
      .bubble time{position:absolute;bottom:-16px;right:8px;color:#94a3b8;font-size:11px}
      .composer{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;padding:10px;border-top:1px solid #e5e7eb}
      .composer input[type=text]{padding:10px;border:1px solid #e5e7eb;border-radius:8px}
      .composer button{padding:10px 12px;border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:8px}
      .row{display:flex;gap:8px;align-items:center}
      .typing{color:#64748b;font-size:12px;padding:6px 12px}
      .toast-bar{position:fixed;right:12px;bottom:12px;display:flex;flex-direction:column;gap:8px;z-index:50}
      .toast{background:#111827;color:#fff;padding:10px 12px;border-radius:8px;opacity:.96;transform:translateY(0);transition:all .3s}
      .toast.out{opacity:0;transform:translateY(10px)}
    </style>
    <div class="pane">
      <h3>Departments</h3>
      <div class="list depts"></div>
      <h3>Groups</h3>
      <div class="list grps"></div>
    </div>
    <div class="pane">
      <h3>Threads</h3>
      <div class="list threads"></div>
      <div class="messages"></div>
      <div class="typing" style="display:none"></div>
      <div class="composer">
        <input type="text" class="msg" placeholder="Type a message…"/>
        <input type="file" class="file" title="Attach file"/>
        <button class="voice" title="Hold to record">🎙️</button>
        <button class="send">Send</button>
      </div>
    </div>`;
  }

  function fmtTime(iso){ return new Intl.DateTimeFormat(undefined,{ hour:'2-digit', minute:'2-digit'}).format(new Date(iso)); }

  async function init(){
    layout();
    // get me/org
    const me = await api.get('/api/me');
    if (!me?.auth){ toast('Please sign in','error'); return; }
    state.me = me.user; state.orgSlug = me.org.slug;
    await loadDeps(); await loadGroups();
    connectWS();
    bind();
  }

  function bind(){
    const r = el();
    r.querySelector('.send').addEventListener('click', sendText);
    r.querySelector('.file').addEventListener('change', sendFile);
    // voice: press and hold to record
    const voiceBtn = r.querySelector('.voice');
    let mediaRec, chunks = [];
    voiceBtn.addEventListener('mousedown', async ()=>{
      try{
        const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
        mediaRec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        chunks = [];
        mediaRec.ondataavailable = e => { if (e.data.size>0) chunks.push(e.data); };
        mediaRec.onstop = async ()=>{
          const blob = new Blob(chunks, { type:'audio/webm' });
          await uploadMessageBlob(blob, 'voice');
        };
        mediaRec.start(); toast('Recording…','info');
      }catch(e){ toast('Mic error','error'); }
    });
    voiceBtn.addEventListener('mouseup', ()=>{ try{ mediaRec && mediaRec.stop(); toast('Processing…','info'); }catch{} });

    // typing indicator via WS
    const msgInput = r.querySelector('.msg');
    let typingTimeout;
    msgInput.addEventListener('input', ()=>{
      sendTyping(true);
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(()=>sendTyping(false), 1200);
    });
  }

  async function loadDeps(){ const r = await api.get('/api/departments'); state.departments = Array.isArray(r)? r : []; renderDeps(); }
  async function loadGroups(){ const r = await api.get('/api/groups'); state.groups = Array.isArray(r)? r : []; renderGroups(); }

  function renderDeps(){
    const box = el().querySelector('.depts'); box.innerHTML='';
    state.departments.forEach(d=>{
      const item = document.createElement('div'); item.className='item'+(state.currentDepartment?.id===d.id?' active':'');
      const unread = computeUnreadForParent('department', d.id);
      item.innerHTML = `<span>${d.name}</span>${unread?`<span class="badge">${unread}</span>`:''}`;
      item.onclick = ()=>{ state.currentDepartment=d; state.currentGroup=null; loadThreadsForDepartment(d.id); renderDeps(); renderGroups(); };
      box.appendChild(item);
    });
  }

  function renderGroups(){
    const box = el().querySelector('.grps'); box.innerHTML='';
    const groups = state.currentDepartment ? state.groups.filter(g=>g.department_id===state.currentDepartment.id) : state.groups;
    groups.forEach(g=>{
      const item = document.createElement('div'); item.className='item'+(state.currentGroup?.id===g.id?' active':'');
      const unread = computeUnreadForParent('group', g.id);
      item.innerHTML = `<span>${g.name}</span>${unread?`<span class="badge">${unread}</span>`:''}`;
      item.onclick = ()=>{ state.currentGroup=g; state.currentDepartment=null; loadThreadsForGroup(g.id); renderGroups(); renderDeps(); };
      box.appendChild(item);
    });
  }

  async function loadThreadsForDepartment(depId){
    const r = await api.get(`/api/threads?department_id=${encodeURIComponent(depId)}`);
    state.threads = Array.isArray(r)? r : []; state.currentThread = state.threads[0] || null;
    renderThreads(); if (state.currentThread) await loadMessages(state.currentThread.id);
  }
  async function loadThreadsForGroup(grpId){
    const r = await api.get(`/api/threads?group_id=${encodeURIComponent(grpId)}`);
    state.threads = Array.isArray(r)? r : []; state.currentThread = state.threads[0] || null;
    renderThreads(); if (state.currentThread) await loadMessages(state.currentThread.id);
  }

  function renderThreads(){
    const box = el().querySelector('.threads'); box.innerHTML='';
    state.threads.forEach(t=>{
      const item = document.createElement('div'); item.className='item'+(state.currentThread?.id===t.id?' active':'');
      const unread = computeUnreadForThread(t.id);
      item.innerHTML = `<span>${t.title||'Thread'}</span>${unread?`<span class="badge">${unread}</span>`:''}`;
      item.onclick = ()=>{ state.currentThread=t; renderThreads(); loadMessages(t.id); };
      box.appendChild(item);
    });
  }

  async function loadMessages(threadId){
    const r = await api.get(`/api/messages?thread_id=${encodeURIComponent(threadId)}&limit=100`);
    state.messages = Array.isArray(r?.messages)? r.messages : [];
    renderMessages(); scrollToBottom();
    if (state.messages.length){
      const last = state.messages[state.messages.length-1];
      await api.post('/api/messages.read', { thread_id: threadId, last_seen_at: last.created_at });
    }
  }

  function renderMessages(){
    const box = el().querySelector('.messages'); box.innerHTML='';
    state.messages.forEach(m=>{
      const mine = m.sender_id === state.me.id;
      const div = document.createElement('div'); div.className='bubble'+(mine?' me':'');
      let inner = '';
      if (m.kind==='text') inner = escapeHtml(m.body?.text || (typeof m.body==='string'?m.body:''));
      else if (m.kind==='voice') inner = `<audio controls src="/api/cdn/${encodeURIComponent(m.media_url)}"></audio>`;
      else if (m.kind==='file') {
        const name = (m.body?.name) || 'attachment';
        inner = `<a href="/api/cdn/${encodeURIComponent(m.media_url)}" target="_blank">📎 ${escapeHtml(name)}</a>`;
      } else inner = escapeHtml(m.kind);
      div.innerHTML = `${inner}<time>${fmtTime(m.created_at)}</time>`;
      box.appendChild(div);
    });
  }

  function computeUnreadForParent(kind, id){
    // Placeholder: requires fetching message_reads to compute accurately.
    // Keep at 0 for now; you can enhance by exposing an endpoint that returns counts per parent.
    return 0;
  }
  function computeUnreadForThread(threadId){ return 0; }

  async function sendText(){
    if (!state.currentThread) return toast('Pick a thread','info');
    const input = el().querySelector('.composer .msg');
    const text = input.value.trim(); if (!text) return;
    toast('Sending…','info');
    const res = await api.post('/api/messages', { thread_id: state.currentThread.id, kind:'text', body:{ text } });
    if (res?.id){ input.value=''; await loadMessages(state.currentThread.id); }
    else toast('Failed','error');
  }

  async function sendFile(e){
    if (!state.currentThread) return toast('Pick a thread','info');
    const f = e.target.files?.[0]; if (!f) return;
    toast('Uploading…','info');
    const fd = new FormData(); fd.append('file', f);
    const up = await fetch('/api/uploads/message', { method:'POST', credentials:'include', body: fd }).then(r=>r.json());
    if (!up?.url) return toast('Upload failed','error');
    const kind = f.type.startsWith('audio/') ? 'voice' : 'file';
    const body = kind==='file' ? { name: f.name, size: f.size, type: f.type } : {};
    const res = await api.post('/api/messages', { thread_id: state.currentThread.id, kind, body, media_url: up.url });
    if (res?.id){ toast('Sent','success'); await loadMessages(state.currentThread.id); e.target.value=''; }
    else toast('Failed','error');
  }

  async function uploadMessageBlob(blob, kind){
    if (!state.currentThread) return toast('Pick a thread','info');
    const fd = new FormData(); fd.append('file', new File([blob], `${kind}-${Date.now()}.webm`, { type: blob.type||'audio/webm' }));
    const up = await fetch('/api/uploads/message', { method:'POST', credentials:'include', body: fd }).then(r=>r.json());
    if (!up?.url) return toast('Upload failed','error');
    const res = await api.post('/api/messages', { thread_id: state.currentThread.id, kind, media_url: up.url });
    if (res?.id){ toast('Sent','success'); await loadMessages(state.currentThread.id); }
  }

  function connectWS(){
    if (!window.ORG_WS_BASE) return; // optional
    try{
      const proto = window.ORG_WS_BASE.replace(/^http/,'ws');
      const ws = new WebSocket(proto+"/ws/org/"+encodeURIComponent(state.orgSlug||'general'));
      state.ws = ws;
      ws.onopen = ()=>{};
      ws.onmessage = ev=>{
        try{
          const msg = JSON.parse(ev.data);
          if (msg.type === 'message.new' && state.currentThread && msg.thread_id===state.currentThread.id){
            state.messages.push({ id: msg.id, sender_id: msg.sender_id, kind: msg.kind, body: msg.body, media_url: msg.media_url, created_at: msg.created_at });
            renderMessages(); scrollToBottom();
          }
          if (msg.type === 'typing' && state.currentThread && msg.thread_id===state.currentThread.id && msg.user_id!==state.me.id){
            const ty = el().querySelector('.typing');
            if (msg.on){ state.typingUsers.add(msg.user_id); ty.style.display='block'; ty.textContent = 'Someone is typing…'; }
            else { state.typingUsers.delete(msg.user_id); if (!state.typingUsers.size){ ty.style.display='none'; ty.textContent=''; } }
          }
        }catch{}
      };
    }catch(e){ console.warn('WS', e); }
  }

  function sendTyping(on){ if (!state.ws || !state.currentThread) return; try{ state.ws.send(JSON.stringify({ type:'typing', thread_id: state.currentThread.id, user_id: state.me.id, on })); }catch{} }

  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
  function scrollToBottom(){ const box = el().querySelector('.messages'); box.scrollTop = box.scrollHeight; }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
