// --- helpers: JSON, crypto, cookies ---
const tenc = new TextEncoder();
async function hashPassword(password, saltB=null, iterations=150_000){
  const salt = saltB || crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', tenc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt, iterations}, key, 256);
  const hash = btoa(String.fromCharCode(...new Uint8Array(bits)));
  const saltB64 = btoa(String.fromCharCode(...salt));
  return { hash, salt: saltB64, iterations };
}
async function verifyPassword(password, saltB64, iterations, expectedB64){
  const salt = Uint8Array.from(atob(saltB64), c=>c.charCodeAt(0));
  const { hash } = await hashPassword(password, salt, iterations);
  // constant-time compare
  const a = atob(hash); const b = atob(expectedB64);
  if (a.length !== b.length) return false;
  let diff = 0; for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function json(data, init={}){
  return new Response(JSON.stringify(data), { headers: {'content-type':'application/json', ...(init.headers||{})}, status: init.status||200 });
}
function bad(msg, status=400){ return json({ok:false, error:msg}, {status}); }
function now(){ return Math.floor(Date.now()/1000); }
function days(n){ return n*24*60*60; }
function randToken(bytes=32){
  const b = new Uint8Array(bytes); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
const COOKIE_NAME = 'PU_SESSION';
function makeCookie(token, ttlDays=30){
  if (!token) { // expire
    return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`;
  }
  const maxAge = days(ttlDays);
  return `${COOKIE_NAME}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax; Secure`;
}
function readCookie(request, name){
  const raw = request.headers.get('cookie') || '';
  const parts = raw.split(';').map(s=>s.trim());
  for (const p of parts){
    const [k, ...rest] = p.split('='); if (k === name) return rest.join('=');
  }
  return null;
}
async function getSessionUser(env, request){
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT u.id, u.email, u.username, u.name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
  ).bind(token).first();
  if (!row) return null;
  if (row.expires_at < now()){
    // cleanup
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  return row;
}

export const onRequestPost = async ({ env, request }) => {
  const token = readCookie(request, COOKIE_NAME);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return new Response(JSON.stringify({ ok:true }), {
    status: 200,
    headers: { 'content-type':'application/json', 'set-cookie': makeCookie(null) }
  });
};
