// /dashboard-chat-pro.js  — client-only chat UI (no exports, no modules)
(function () {
  const ROOT_ID = 'chat-root';

  // --------------- utils ---------------
  const $root = () => document.getElementById(ROOT_ID);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtTime = iso => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const toast = (msg, type = 'info') => {
    let bar = document.querySelector('.toast-bar');
    if (!bar) { bar = document.createElement('div'); bar.className = 'toast-bar'; document.body.appendChild(bar); }
    const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg; bar.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 1800);
  };
  // Prefer /cdn/<key>; fall back to /api/cdn/<key> if your stack uses that
  const fileUrl = (keyOrUrl) => {
    if (!keyOrUrl) return '';
    if (/^https?:\/\//i.test(keyOrUrl)) return keyOrUrl;
    return `/cdn/${encodeURIComponent(keyOrUrl)}`;
  };

  // --------------- API helpers ---------------
  const api = {
    get: (u) => fetch(u, { credentials: 'include' }).then(r => r.json()),
    postJson: (u, b) => fetch(u, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b)
    }).then(r => r.json()),
    postForm: (u, fd) => fetch(u, { method: 'POST', credentials: 'include', body: fd }).then(r => r.json()),
  };

  // --------------- state ---------------
  const state = {
    me: null,
    orgSlug: null,
    departments: [],
    groups: [],
    threads: [],
    messages: [],
    currentDepartment: null,
    currentGroup: null,
    currentThread: null,
    typingUsers: new Set(),
    ws: null,
  };

  // --------------- layout ---------------
  function layout() {
    const r = $root(); if (!r) return;
    r.innerHTML = `
    <style>
      #${ROOT_ID}{display:grid;grid-template-columns:260px 1fr;gap:12px;height:76vh}
      .pane{border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;background:#fff}
      .pane h3{margin:0;padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#fafafa;font-size:14px}
      .list{overflow:auto}
      .item{padding:10px 12px;cursor:pointer;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;gap:8px}
      .item:hover{background:#f8fafc}
      .item.active{background:#eef2ff}
      .badge{background:#ef4444;color:#fff;border-radius:9999px;padding:0 8px;font-size:11px;min-width:18px;text-align:center}
      .messages{flex:1;overflow:auto;background:#fff}
      .bubble{max-width:72%;margin:10px 12px;padding:10px 12px;border-radius:14px;background:#f1f5f9;position:relative;line-height:1.35;word-wrap:break-word}
      .bubble.me{background:#e0f2fe;margin-left:auto}
      .bubble time{position:absolute;bottom:-16px;right:8px;color:#94a3b8;font-size:11px}
      .composer{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fafafa}
      .composer input[type=text]{padding:10px;border:1px solid #e5e7eb;border-radius:8px}
      .composer button{padding:10px 12px;border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:8px}
      .typing{color:#64748b;font-size:12px;padding:6px 12px}
      .row{display:flex;gap:8px;align-items:center}
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

  // --------------- boot ---------------
  async function init() {
    layout();

    // who am I?
    const me = await api.get('/api/me').catch(() => null);
    if (!me?.auth) { toast('Please sign in', 'error'); return; }
    state.me = me.user;
    state.orgSlug = me.org?.slug || null;

    await loadDeps();
    await loadGroups();
    bind();
    connectWS();
  }

  // --------------- data loads ---------------
  async function loadDeps() {
    const r = await api.get('/api/departments').catch(() => []);
    state.departments = Array.isArray(r) ? r : [];
    renderDeps();
  }
  async function loadGroups() {
    const r = await api.get('/api/groups').catch(() => []);
    state.groups = Array.isArray(r) ? r : [];
    renderGroups();
  }
  async function loadThreadsForDepartment(depId) {
    const r = await api.get(`/api/threads?department_id=${encodeURIComponent(depId)}`).catch(() => []);
    state.threads = Array.isArray(r) ? r : [];
    state.currentThread = state.threads[0] || null;
    renderThreads();
    if (state.currentThread) await loadMessages(state.currentThread.id);
  }
  async function loadThreadsForGroup(grpId) {
    const r = await api.get(`/api/threads?group_id=${encodeURIComponent(grpId)}`).catch(() => []);
    state.threads = Array.isArray(r) ? r : [];
    state.currentThread = state.threads[0] || null;
    renderThreads();
    if (state.currentThread) await loadMessages(state.currentThread.id);
  }
  async function loadMessages(threadId) {
    const r = await api.get(`/api/messages?thread_id=${encodeURIComponent(threadId)}&limit=100`).catch(() => null);
    state.messages = Array.isArray(r?.messages) ? r.messages : (Array.isArray(r) ? r : []);
    renderMessages();
    scrollToBottom();

    if (state.messages.length) {
      const last = state.messages[state.messages.length - 1];
      await api.postJson('/api/messages.read', { thread_id: threadId, last_seen_at: last.created_at }).catch(() => {});
    }
  }

  // --------------- render ---------------
  function renderDeps() {
    const r = $root(); if (!r) return;
    const box = r.querySelector('.depts'); if (!box) return;
    box.innerHTML = '';
    state.departments.forEach(d => {
      const item = document.createElement('div');
      item.className = 'item' + (state.currentDepartment?.id === d.id ? ' active' : '');
      const unread = computeUnreadForParent('department', d.id);
      item.innerHTML = `<span>${esc(d.name)}</span>${unread ? `<span class="badge">${unread}</span>` : ''}`;
      item.onclick = () => { state.currentDepartment = d; state.currentGroup = null; loadThreadsForDepartment(d.id); renderDeps(); renderGroups(); };
      box.appendChild(item);
    });
  }

  function renderGroups() {
    const r = $root(); if (!r) return;
    const box = r.querySelector('.grps'); if (!box) return;
    box.innerHTML = '';
    const groups = state.currentDepartment ? state.groups.filter(g => g.department_id === state.currentDepartment.id) : state.groups;
    groups.forEach(g => {
      const item = document.createElement('div');
      item.className = 'item' + (state.currentGroup?.id === g.id ? ' active' : '');
      const unread = computeUnreadForParent('group', g.id);
      item.innerHTML = `<span>${esc(g.name)}</span>${unread ? `<span class="badge">${unread}</span>` : ''}`;
      item.onclick = () => { state.currentGroup = g; state.currentDepartment = null; loadThreadsForGroup(g.id); renderGroups(); renderDeps(); };
      box.appendChild(item);
    });
  }

  function renderThreads() {
    const r = $root(); if (!r) return;
    const box = r.querySelector('.threads'); if (!box) return;
    box.innerHTML = '';
    state.threads.forEach(t => {
      const item = document.createElement('div');
      item.className = 'item' + (state.currentThread?.id === t.id ? ' active' : '');
      const unread = computeUnreadForThread(t.id);
      item.innerHTML = `<span>${esc(t.title || 'Thread')}</span>${unread ? `<span class="badge">${unread}</span>` : ''}`;
      item.onclick = () => { state.currentThread = t; renderThreads(); loadMessages(t.id); };
      box.appendChild(item);
    });
  }

  function renderMessages() {
    const r = $root(); if (!r) return;
    const box = r.querySelector('.messages'); if (!box) return;
    box.innerHTML = '';
    state.messages.forEach(m => {
      const mine = m.sender_id === state.me.id;
      const div = document.createElement('div');
      div.className = 'bubble' + (mine ? ' me' : '');

      let inner = '';
      if (m.kind === 'text') {
        // Support either server field: body.text OR content
        const text = (m.body && typeof m.body === 'object' ? m.body.text : null) ?? (typeof m.content === 'string' ? m.content : '');
        inner = esc(text);
      } else if (m.kind === 'voice') {
        inner = `<audio controls src="${fileUrl(m.media_url)}"></audio>`;
      } else if (m.kind === 'file') {
        const name = (m.body?.name) || 'attachment';
        inner = `<a href="${fileUrl(m.media_url)}" target="_blank" rel="noopener">📎 ${esc(name)}</a>`;
      } else {
        inner = esc(m.kind);
      }

      div.innerHTML = `${inner}<time>${fmtTime(m.created_at)}</time>`;
      box.appendChild(div);
    });
  }

  // --------------- composer ---------------
  function bind() {
    const r = $root(); if (!r) return;
    const sendBtn = r.querySelector('.send');
    const fileInp = r.querySelector('.file');
    const voiceBtn = r.querySelector('.voice');
    const msgInput = r.querySelector('.msg');
    const typingEl = r.querySelector('.typing');

    sendBtn?.addEventListener('click', sendText);
    fileInp?.addEventListener('change', sendFile);

    // Voice: press and hold (pointer events work for mouse/touch)
    let mediaRec = null, chunks = [];
    async function startRecording() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        chunks = [];
        mediaRec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        mediaRec.onstop = async () => {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          await uploadMessageBlob(blob, 'voice');
        };
        mediaRec.start();
        toast('Recording…', 'info');
      } catch (e) {
        toast('Mic error', 'error');
      }
    }
    function stopRecording() {
      try { if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop(); toast('Processing…', 'info'); } catch {}
    }
    voiceBtn?.addEventListener('pointerdown', startRecording);
    voiceBtn?.addEventListener('pointerup', stopRecording);
    voiceBtn?.addEventListener('pointerleave', stopRecording);

    // Typing indicator throttle
    let typingTimeout;
    msgInput?.addEventListener('input', () => {
      sendTyping(true);
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => sendTyping(false), 1200);
    });

    // show/hide typing text based on state.typingUsers is handled in WS onmessage
    if (typingEl) { typingEl.style.display = 'none'; typingEl.textContent = ''; }
  }

  async function sendText() {
    if (!state.currentThread) return toast('Pick a thread', 'info');
    const r = $root(); if (!r) return;
    const input = r.querySelector('.composer .msg');
    const text = (input?.value || '').trim();
    if (!text) return;

    toast('Sending…', 'info');

    // Send both "content" (string) and "body" (object) so we’re compatible with either server shape
    const payload = {
      thread_id: state.currentThread.id,
      kind: 'text',
      content: text,           // ≤— for servers expecting "content"
      body: { text }           // ≤— for servers expecting "body.text"
    };

    const res = await api.postJson('/api/messages', payload).catch(() => null);
    if (res?.id || res?.ok) {
      if (input) input.value = '';
      await loadMessages(state.currentThread.id);
    } else {
      toast('Failed', 'error');
    }
  }

  async function sendFile(e) {
    if (!state.currentThread) return toast('Pick a thread', 'info');
    const f = e.target?.files?.[0]; if (!f) return;
    toast('Uploading…', 'info');

    const fd = new FormData(); fd.append('file', f);
    const up = await api.postForm('/api/uploads/message', fd).catch(() => null);
    if (!up?.url) return toast('Upload failed', 'error');

    const kind = f.type?.startsWith('audio/') ? 'voice' : 'file';
    const payload = {
      thread_id: state.currentThread.id,
      kind,
      media_url: up.url,
      // Provide both shapes again (object + string)
      body: kind === 'file' ? { name: f.name, size: f.size, type: f.type } : {},
      content: f.name
    };

    const res = await api.postJson('/api/messages', payload).catch(() => null);
    if (res?.id || res?.ok) {
      toast('Sent', 'success');
      await loadMessages(state.currentThread.id);
      e.target.value = '';
    } else {
      toast('Failed', 'error');
    }
  }

  async function uploadMessageBlob(blob, kind) {
    if (!state.currentThread) return toast('Pick a thread', 'info');
    const fd = new FormData();
    fd.append('file', new File([blob], `${kind}-${Date.now()}.webm`, { type: blob.type || 'audio/webm' }));
    const up = await api.postForm('/api/uploads/message', fd).catch(() => null);
    if (!up?.url) return toast('Upload failed', 'error');

    const res = await api.postJson('/api/messages', {
      thread_id: state.currentThread.id,
      kind,
      media_url: up.url,
      content: `${kind} message`
    }).catch(() => null);

    if (res?.id || res?.ok) {
      toast('Sent', 'success');
      await loadMessages(state.currentThread.id);
    }
  }

  // --------------- unread placeholders ---------------
  function computeUnreadForParent(_kind, _id) { return 0; }
  function computeUnreadForThread(_threadId) { return 0; }

  // --------------- websockets ---------------
  function connectWS() {
    const base = window.ORG_WS_BASE;
    if (!base) return; // optional feature

    try {
      const proto = base.replace(/^http/, 'ws');
      const socket = new WebSocket(`${proto}/ws/org/${encodeURIComponent(state.orgSlug || 'general')}`);
      state.ws = socket;

      socket.onopen = () => { /* optionally send presence */ };
      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'message.new' && state.currentThread && msg.thread_id === state.currentThread.id) {
            state.messages.push({
              id: msg.id, sender_id: msg.sender_id, kind: msg.kind,
              body: msg.body, content: msg.content, media_url: msg.media_url,
              created_at: msg.created_at
            });
            renderMessages(); scrollToBottom();
          }
          if (msg.type === 'typing' && state.currentThread && msg.thread_id === state.currentThread.id && msg.user_id !== state.me.id) {
            const r = $root(); if (!r) return;
            const el = r.querySelector('.typing'); if (!el) return;
            if (msg.on) {
              state.typingUsers.add(msg.user_id);
              el.style.display = 'block'; el.textContent = 'Someone is typing…';
            } else {
              state.typingUsers.delete(msg.user_id);
              if (state.typingUsers.size === 0) { el.style.display = 'none'; el.textContent = ''; }
            }
          }
        } catch { /* ignore */ }
      };
      socket.onerror = () => { /* optional logging */ };
      socket.onclose = () => { /* optional: retry/backoff */ };
    } catch (e) {
      console.warn('WS init failed:', e);
    }
  }
  function sendTyping(on) {
    if (!state.ws || !state.currentThread) return;
    try {
      state.ws.send(JSON.stringify({ type: 'typing', thread_id: state.currentThread.id, user_id: state.me.id, on }));
    } catch {}
  }

  // --------------- start ---------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
