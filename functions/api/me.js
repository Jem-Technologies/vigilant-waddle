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

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) return j({ error: "Database not bound (env.DB missing)" }, 500);

    const cookie = request.headers.get("cookie") || "";
    const sess = parseCookie(cookie).sess;
    if (!sess) return j({ auth: false });

    const now = Math.floor(Date.now() / 1000);
    const row = await env.DB
      .prepare(`
        SELECT users.id, users.name, users.username, users.email, users.role
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.id=?1 AND sessions.expires_at > ?2
        LIMIT 1
      `)
      .bind(sess, now)
      .first();

    if (!row) return j({ auth: false });
    return j({ auth: true, user: row });
  } catch (e) {
    return j({ error: "Unhandled error", detail: String(e?.message || e) }, 500);
  }
}
function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" }});
}
function parseCookie(c) {
  const out = {};
  c.split(/;\s*/).forEach(kv => {
    const [k, ...rest] = kv.split("=");
    if (!k) return;
    out[k.trim()] = decodeURIComponent((rest.join("=") || "").trim());
  });
  return out;
}


export const onRequestGet = async ({ env, request }) => {
  const user = await getSessionUser(env, request);
  if (!user) return bad('Not authenticated', 401);
  return json({ ok:true, user: { id:user.id, email:user.email, username:user.username, name:user.name, role:user.role } });
};
