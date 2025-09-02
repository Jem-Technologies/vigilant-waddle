// functions/api/signup.js
export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({ error: "Database not bound (env.DB is missing). Add a D1 binding named 'DB' in Pages → Settings → Functions → D1 bindings." }, 500);
    }

    // Parse input
    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Invalid JSON body" }, 400); }

    const name = (body.name || "").trim();
    const username = (body.username || "").trim().toLowerCase();
    const email = (body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!name || !username || !email || !password) return json({ error: "name, username, email, and password are required" }, 400);
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return json({ error: "username must be 3-32 chars: letters, digits, . _ -" }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "invalid email" }, 400);
    if (password.length < 8) return json({ error: "password must be at least 8 characters" }, 400);

    // Ensure schema (no DB.exec; fully compatible)
    await ensureSchemaCompat(env.DB);

    // First user → Admin
    const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first();
    const isFirstUser = Number(countRow?.c || 0) === 0;
    const role = isFirstUser ? "Admin" : "Member";

    // Hash
    const userId = crypto.randomUUID();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await pbkdf2(password, salt, 150_000);

    // Insert user
    try {
      await env.DB.prepare(
        `INSERT INTO users (id, name, username, email, role, pwd_hash, pwd_salt, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())`
      ).bind(userId, name, username, email, role, new Uint8Array(hash), salt).run();
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes("UNIQUE") && (msg.includes("users.username") || msg.includes("users.email"))) {
        return json({ error: "username or email already exists" }, 409);
      }
      return json({ error: "DB insert failed", detail: msg }, 500);
    }

    // Session
    const sessionId = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30d
    try {
      await env.DB.prepare(
        `INSERT INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?1, ?2, ?3, unixepoch())`
      ).bind(sessionId, userId, expiresAt).run();
    } catch (e) {
      // Rollback user if session fails (best-effort)
      await env.DB.prepare("DELETE FROM users WHERE id=?1").bind(userId).run();
      return json({ error: "Session create failed", detail: String(e?.message || e) }, 500);
    }

    // Cookie
    const cookie = makeSessionCookie(sessionId, expiresAt);
    return new Response(JSON.stringify({ ok: true, user: { id: userId, name, username, email, role } }), {
      status: 201,
      headers: { "content-type": "application/json; charset=utf-8", "set-cookie": cookie }
    });

  } catch (err) {
    // Show detailed info so we can pinpoint quickly
    return json({ error: "Unhandled error", detail: String(err?.message || err) }, 500);
  }
}

// ---- helpers ----
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

async function pbkdf2(password, saltBytes, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations }, key, 256);
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

// Exec-free schema creation (works on all D1 versions)
async function ensureSchemaCompat(DB) {
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'Member',
      pwd_hash BLOB NOT NULL,
      pwd_salt BLOB NOT NULL,
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
