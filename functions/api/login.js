// functions/api/login.js
export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return j({ where: "preflight", error: "Database not bound (env.DB missing)." }, 500);

    let body;
    try { body = await request.json(); }
    catch { return j({ where: "parse", error: "Invalid JSON body" }, 400); }

    const id = String(body.id || "").trim().toLowerCase();   // email OR username
    const password = String(body.password || "");
    if (!id || !password) return j({ where: "validate", error: "id (email/username) and password are required" }, 400);

    const user = await env.DB.prepare(`
      SELECT id, name, username, email, role, pwd_hash, pwd_salt
      FROM users
      WHERE lower(email)=?1 OR lower(username)=?1
      LIMIT 1
    `).bind(id).first();

    if (!user) return j({ where: "lookup", error: "Invalid credentials" }, 401);

    const saltU8 = b64decodeToU8(user.pwd_salt);
    const expectedHash = b64decodeToU8(user.pwd_hash);
    const derived = await pbkdf2(password, saltU8, 150_000);
    const actual = new Uint8Array(derived);

    if (!timingSafeEq(actual, expectedHash)) return j({ where: "verify", error: "Invalid credentials" }, 401);

    // New session (30d)
    const sessionId = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
    try {
      await env.DB.prepare(
        `INSERT INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?1, ?2, ?3, unixepoch())`
      ).bind(sessionId, user.id, expiresAt).run();
    } catch (e) {
      return j({ where: "insert-session", error: "Session create failed", detail: String(e?.message || e) }, 500);
    }

    const cookie = makeSessionCookie(sessionId, expiresAt);
    return new Response(JSON.stringify({
      ok: true,
      user: { id: user.id, name: user.name, username: user.username, email: user.email, role: user.role }
    }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "set-cookie": cookie } });

  } catch (err) {
    return j({ where: "top", error: "Unhandled error", detail: String(err?.message || err) }, 500);
  }
}

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
async function pbkdf2(password, saltBytes, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations }, key, 256);
}
function b64decodeToU8(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function makeSessionCookie(sessionId, expUnix) {
  const expires = new Date(expUnix * 1000).toUTCString();
  return [`sess=${encodeURIComponent(sessionId)}`, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Expires=${expires}`].join("; ");
}
function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
