// functions/api/signup.js
const PBKDF2_ITERS = 100_000; // Cloudflare cap

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return j({ where: "preflight", error: "Database not bound (env.DB missing). Bind D1 as 'DB' in Pages → Settings → Functions." }, 500);
    }

    // Parse JSON
    let body;
    try { body = await request.json(); }
    catch { return j({ where: "parse", error: "Invalid JSON body" }, 400); }

    const name = (body.name || "").trim();
    const username = (body.username || "").trim().toLowerCase();
    const email = (body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    // NEW: org slug (optional). If missing, derive from username.
    const orgSlug = slugify(body.org || username);

    if (!name || !username || !email || !password) return j({ where: "validate", error: "name, username, email, and password are required" }, 400);
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return j({ where: "validate", error: "username must be 3-32 chars: letters, digits, . _ -" }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return j({ where: "validate", error: "invalid email" }, 400);
    if (password.length < 8) return j({ where: "validate", error: "password must be at least 8 characters" }, 400);

    // Ensure tables (idempotent) — now includes org tables and org_id on sessions
    await ensureSchemaCompat(env.DB);

    // --- ORG: find or create ---
    let org = await env.DB
      .prepare(`SELECT id, slug, name FROM organizations WHERE slug=?1`)
      .bind(orgSlug)
      .first();

    if (!org) {
      const orgId = crypto.randomUUID();
      const orgName = body.orgName || `${capitalize(name.split(" ")[0] || username)}’s Organization`;
      await env.DB
        .prepare(`INSERT INTO organizations (id, slug, name, created_at) VALUES (?1, ?2, ?3, unixepoch())`)
        .bind(orgId, orgSlug, orgName)
        .run();
      org = { id: orgId, slug: orgSlug, name: orgName };
    }

    // --- USER: hash password → base64 TEXT (avoid BLOB binding quirks) ---
    const userId = crypto.randomUUID();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const derived = await pbkdf2(password, salt, PBKDF2_ITERS);
    const hash = new Uint8Array(derived); // 32 bytes
    const saltB64 = b64encode(salt);
    const hashB64 = b64encode(hash);

    try {
      await env.DB.prepare(
        `INSERT INTO users (id, name, username, email, role, pwd_hash, pwd_salt, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())`
      ).bind(userId, name, username, email, "Member", hashB64, saltB64).run();
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes("UNIQUE") && (msg.includes("users.username") || msg.includes("users.email"))) {
        return j({ where: "insert-user", error: "username or email already exists" }, 409);
      }
      return j({ where: "insert-user", error: "DB insert failed", detail: msg }, 500);
    }

    // --- MEMBERSHIP: first member of this org becomes Admin ---
    const countOrg = await env.DB
      .prepare(`SELECT COUNT(*) AS c FROM user_orgs WHERE org_id=?1`)
      .bind(org.id)
      .first();
    const isFirstInOrg = Number(countOrg?.c || 0) === 0;
    const orgRole = isFirstInOrg ? "Admin" : "Member";

    await env.DB
      .prepare(`INSERT OR REPLACE INTO user_orgs (user_id, org_id, role, created_at) VALUES (?1, ?2, ?3, unixepoch())`)
      .bind(userId, org.id, orgRole)
      .run();

    // --- SESSION (30d) — scope to org ---
    const sessionId = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
    try {
      await env.DB.prepare(
        `INSERT INTO sessions (id, user_id, org_id, expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4, unixepoch())`
      ).bind(sessionId, userId, org.id, expiresAt).run();
    } catch (e) {
      // best-effort rollback
      await env.DB.prepare(`DELETE FROM user_orgs WHERE user_id=?1 AND org_id=?2`).bind(userId, org.id).run().catch(()=>{});
      await env.DB.prepare(`DELETE FROM users WHERE id=?1`).bind(userId).run().catch(()=>{});
      return j({ where: "insert-session", error: "Session create failed", detail: String(e?.message || e) }, 500);
    }

    const cookie = makeSessionCookie(sessionId, expiresAt);
    return new Response(
      JSON.stringify({
        ok: true,
        user: { id: userId, name, username, email, role: orgRole },
        org:  { id: org.id, slug: org.slug, name: org.name }
      }),
      { status: 201, headers: { "content-type": "application/json; charset=utf-8", "set-cookie": cookie } }
    );

  } catch (err) {
    return j({ where: "top", error: "Unhandled error", detail: String(err?.message || err) }, 500);
  }
}

// --------- helpers (kept from your style) ----------
function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
async function pbkdf2(password, saltBytes, iterations) {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
    return await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations }, key, 256);
  } catch (e) {
    throw new Error(`Pbkdf2 failed: ${String(e?.message || e)}`);
  }
}
function b64encode(uint8) {
  let s = "";
  for (let i = 0; i < uint8.length; i++) s += String.fromCharCode(uint8[i]);
  return btoa(s);
}
function makeSessionCookie(sessionId, expUnix) {
  const expires = new Date(expUnix * 1000).toUTCString();
  return [`sess=${encodeURIComponent(sessionId)}`, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Expires=${expires}`].join("; ");
}
// NEW: org utils + schema upgrades
function slugify(x) {
  return String(x || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function capitalize(s){ s=String(s||""); return s ? s[0].toUpperCase()+s.slice(1) : s; }

async function ensureSchemaCompat(DB) {
  // users (existing)
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

  // sessions (now with org_id)
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `).run();
  // add org_id if missing
  await DB.prepare(`ALTER TABLE sessions ADD COLUMN org_id TEXT`).run().catch(()=>{});
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);`).run();
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_org ON sessions(org_id);`).run();

  // organizations (tenant)
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `).run();

  // user_orgs (membership)
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_orgs (
      user_id TEXT NOT NULL,
      org_id  TEXT NOT NULL,
      role    TEXT NOT NULL DEFAULT 'Member',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, org_id)
    );
  `).run();
}
