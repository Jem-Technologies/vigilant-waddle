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
    const orgSlug = slugify(body.org || username);                  // keep your behavior
    const orgNameInput = (body.orgName || "").trim();

    if (!name || !username || !email || !password) return j({ where: "validate", error: "name, username, email, and password are required" }, 400);
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return j({ where: "validate", error: "username must be 3-32 chars: letters, digits, . _ -" }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return j({ where: "validate", error: "invalid email" }, 400);
    if (password.length < 8) return j({ where: "validate", error: "password must be at least 8 characters" }, 400);

    // Ensure schema
    await ensureSchemaCompat(env.DB);

    // --- ORG: find or create (reuse if slug exists) ---
    let org = await env.DB
      .prepare(`SELECT id, slug, name FROM organizations WHERE slug=?1`)
      .bind(orgSlug)
      .first();

    if (!org) {
      const orgId = crypto.randomUUID();
      const orgName = orgNameInput || `${capitalize(name.split(" ")[0] || username)}’s Organization`;
      await env.DB
        .prepare(`INSERT INTO organizations (id, slug, name, created_at) VALUES (?1, ?2, ?3, unixepoch())`)
        .bind(orgId, orgSlug, orgName)
        .run();
      org = { id: orgId, slug: orgSlug, name: orgName };
    }

    // --- Pre-checks for idempotency & clearer 409s ---
    const existingByEmail = await env.DB
      .prepare(`SELECT id, name, username, email FROM users WHERE email=?1`)
      .bind(email)
      .first();

    // If the user already exists *and* already belongs to this org → idempotent OK (UI can redirect to login)
    if (existingByEmail) {
      const hasMembership = await env.DB
        .prepare(`SELECT 1 FROM user_orgs WHERE user_id=?1 AND org_id=?2`)
        .bind(existingByEmail.id, org.id)
        .first();

      if (hasMembership) {
        // Optionally also drop a new 30d session cookie to be extra friendly (commented out)
        // const { cookie } = await createSession(env.DB, existingByEmail.id, org.id);
        return new Response(JSON.stringify({
          ok: true,
          alreadyExists: true,
          message: "Account already exists. Please login.",
          user: { id: existingByEmail.id, email: existingByEmail.email, username: existingByEmail.username },
          org
        }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" /*, "set-cookie": cookie*/ }
        });
      }
      // Same email but not a member of this org → treat as EMAIL_TAKEN to keep signup semantics strict.
      return j({ where: "precheck", error: "Email is already registered", code: "EMAIL_TAKEN" }, 409);
    }

    // Also check username uniqueness in advance to return a clean code (optional but nicer UX)
    const existingByUsername = await env.DB
      .prepare(`SELECT id FROM users WHERE username=?1`)
      .bind(username)
      .first();
    if (existingByUsername) {
      return j({ where: "precheck", error: "Username is already taken", code: "USERNAME_TAKEN" }, 409);
    }

    // --- USER: hash password → base64 TEXT ---
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
      if (msg.includes("UNIQUE")) {
        if (msg.includes("users.email"))    return j({ where: "insert-user", error: "Email is already registered", code: "EMAIL_TAKEN" }, 409);
        if (msg.includes("users.username")) return j({ where: "insert-user", error: "Username is already taken", code: "USERNAME_TAKEN" }, 409);
      }
      return j({ where: "insert-user", error: "DB insert failed", detail: msg }, 500);
    }

    // --- MEMBERSHIP: first member of this org becomes Owner (kept) ---
    const countOrg = await env.DB
      .prepare(`SELECT COUNT(*) AS c FROM user_orgs WHERE org_id=?1`)
      .bind(org.id)
      .first();
    const isFirstInOrg = Number(countOrg?.c || 0) === 0;
    const orgRole = isFirstInOrg ? "Owner" : "Member";

    await env.DB
      .prepare(`INSERT OR REPLACE INTO user_orgs (user_id, org_id, role, created_at) VALUES (?1, ?2, ?3, unixepoch())`)
      .bind(userId, org.id, orgRole)
      .run();

    // --- Optional seed for 1st user: General/Announcements + default thread/message ---
    if (isFirstInOrg) {
      await seedFirstOrg(env.DB, org.id, userId);
    }

    // --- SESSION (30d) — scope to org ---
    const { cookie, sessionId } = await createSession(env.DB, userId, org.id);

    return new Response(
      JSON.stringify({
        ok: true,
        user: { id: userId, name, username, email, role: orgRole },
        org:  { id: org.id, slug: org.slug, name: org.name },
        session: { id: sessionId }
      }),
      { status: 201, headers: { "content-type": "application/json; charset=utf-8", "set-cookie": cookie } }
    );

  } catch (err) {
    return j({ where: "top", error: "Unhandled error", detail: String(err?.message || err) }, 500);
  }
}

// --------- helpers ----------
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
function slugify(x) {
  return String(x || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function capitalize(s){ s=String(s||""); return s ? s[0].toUpperCase()+s.slice(1) : s; }

async function ensureSchemaCompat(DB) {
  // users
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

  // sessions (with org_id)
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `).run();
  await DB.prepare(`ALTER TABLE sessions ADD COLUMN org_id TEXT`).run().catch(()=>{});
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);`).run();
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_org ON sessions(org_id);`).run();

  // organizations
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `).run();

  // user_orgs
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_orgs (
      user_id TEXT NOT NULL,
      org_id  TEXT NOT NULL,
      role    TEXT NOT NULL DEFAULT 'Member',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, org_id)
    );
  `).run();

  // Chat core (safe if you already ran my schema)
  await DB.prepare(`CREATE TABLE IF NOT EXISTS departments (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));`).run();
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_departments_org ON departments(org_id);`).run();
  await DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS uq_departments_org_name ON departments(org_id, name);`).run();

  await DB.prepare(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, department_id TEXT, name TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));`).run();
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_groups_org ON groups(org_id);`).run();
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_groups_dept ON groups(department_id);`).run();

  await DB.prepare(`CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, title TEXT NOT NULL, department_id TEXT, group_id TEXT, created_by TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()));`).run();
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_threads_org ON threads(org_id);`).run();
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_threads_dept ON threads(department_id);`).run();
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_threads_group ON threads(group_id);`).run();

  await DB.prepare(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, sender_id TEXT, kind TEXT NOT NULL, body TEXT, media_url TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));`).run();
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);`).run();

  await DB.prepare(`CREATE TABLE IF NOT EXISTS department_members (department_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (department_id, user_id));`).run();
  await DB.prepare(`CREATE TABLE IF NOT EXISTS group_members (group_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (group_id, user_id));`).run();
}

async function createSession(DB, userId, orgId) {
  const sessionId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30d
  await DB.prepare(
    `INSERT INTO sessions (id, user_id, org_id, expires_at, created_at)
     VALUES (?1, ?2, ?3, ?4, unixepoch())`
  ).bind(sessionId, userId, orgId, expiresAt).run();
  const cookie = makeSessionCookie(sessionId, expiresAt);
  return { cookie, sessionId, expiresAt };
}

async function seedFirstOrg(DB, orgId, userId) {
  const depId = crypto.randomUUID();
  const grpId = crypto.randomUUID();
  const thrId = crypto.randomUUID();

  await DB.batch?.([
    DB.prepare(
      `INSERT INTO departments (id, org_id, name, created_at, updated_at)
       VALUES (?1, ?2, 'General', unixepoch(), unixepoch())`
    ).bind(depId, orgId),
    DB.prepare(
      `INSERT INTO groups (id, org_id, department_id, name, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'Announcements', unixepoch(), unixepoch())`
    ).bind(grpId, orgId, depId),
    DB.prepare(
      `INSERT INTO threads (id, org_id, title, department_id, group_id, created_by, created_at)
       VALUES (?1, ?2, 'Group: Announcements', ?3, ?4, ?5, unixepoch())`
    ).bind(thrId, orgId, depId, grpId, userId),
    DB.prepare(
      `INSERT INTO messages (id, thread_id, sender_id, kind, body, created_at)
       VALUES (?1, ?2, ?3, 'text', json_object('text','Welcome to Announcements!'), datetime('now'))`
    ).bind(crypto.randomUUID(), thrId, userId),
    DB.prepare(
      `INSERT OR IGNORE INTO department_members (department_id, user_id, created_at)
       VALUES (?1, ?2, unixepoch())`
    ).bind(depId, userId),
    DB.prepare(
      `INSERT OR IGNORE INTO group_members (group_id, user_id, created_at)
       VALUES (?1, ?2, unixepoch())`
    ).bind(grpId, userId),
  ]);
}
