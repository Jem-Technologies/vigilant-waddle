// functions/api/signup.js
export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return j({ where: "preflight", error: "Database not bound (env.DB missing). Bind D1 as 'DB' in Pages → Settings → Functions." }, 500);

    // Parse JSON
    let body;
    try { body = await request.json(); }
    catch { return j({ where: "parse", error: "Invalid JSON body" }, 400); }

    const name = (body.name || "").trim();
    const username = (body.username || "").trim().toLowerCase();
    const email = (body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!name || !username || !email || !password) return j({ where: "validate", error: "name, username, email, and password are required" }, 400);
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return j({ where: "validate", error: "username must be 3-32 chars: letters, digits, . _ -" }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return j({ where: "validate", error: "invalid email" }, 400);
    if (password.length < 8) return j({ where: "validate", error: "password must be at least 8 characters" }, 400);

    // Ensure tables (idempotent)
    await ensureSchemaCompat(env.DB);

    // First user?
    const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first();
    const isFirstUser = Number(countRow?.c || 0) === 0;
    const role = isFirstUser ? "Admin" : "Member";

    // Hash password → base64 strings
    const userId = crypto.randomUUID();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const derived = await pbkdf2(password, salt, 150_000);
    const hash = new Uint8Array(derived);            // 32 bytes
    const saltB64 = b64encode(salt);
    const hashB64 = b64encode(hash);

    // Insert user
    try {
      await env.DB.prepare(
        `INSERT INTO users (id, name, username, email, role, pwd_hash, pwd_salt, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())`
      ).bind(userId, name, username, email, role, hashB64, saltB64).run();
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes("UNIQUE") && (msg.includes("users.username") || msg.includes("users.email"))) {
        return j({ where: "insert-user", error: "username or email already exists" }, 409);
      }
      return j({ where: "insert-user", error: "DB insert failed", detail: msg }, 500);
    }

    // Create session (30d)
    const sessionId = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
    try {
      await env.DB.prepare(
        `INSERT INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?1, ?2, ?3, unixepoch())`
      ).bind(sessionId, userId, expiresAt).run();
    } catch (e) {
      await env.DB.prepare("DELETE FROM users WHERE id=?1").bind(userId).run(); // best-effort rollback
      return j({ where: "insert-session", error: "Session create failed", detail: String(e?.message || e) }, 500);
    }

    const cookie = makeSessionCookie(sessionId, expiresAt);
    return new Response(JSON.stringify({ ok: true, user: { id: userId, name, username, email, role } }), {
      status: 201,
      headers: { "content-type": "application/json; charset=utf-8", "set-cookie": cookie }
    });

  } catch (err) {
    return j({ where: "top", error: "Unhandled error", detail: String(err?.message || err) }, 500);
  }
}

// Helpers
function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
async function pbkdf2(password, saltBytes, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations }, key, 256);
}
function b64encode(uint8) {
  let s = "";
  for (let i = 0; i < uint8.length; i++) s += String.fromCharCode(uint8[i]);
  return btoa(s);
}
function b64decodeToU8(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function makeSessionCookie(sessionId, expUnix) {
  const expires = new Date(expUnix * 1000).toUTCString();
  return [
    `sess=${encodeURIComponent(sessionId)}`,
    `Path=/`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
    `Expires=${expires}`
  ].join("; ");
}
async function ensureSchemaCompat(DB) {
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'Member',
      pwd_hash TEXT NOT NULL,  -- base64
      pwd_salt TEXT NOT NULL,  -- base64
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `).run();
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `).run();
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);`).run();
}
