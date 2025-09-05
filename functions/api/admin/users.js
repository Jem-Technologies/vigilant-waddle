// functions/api/users.js
import { getAuthed, json } from "../../_lib/auth.js";

// ---------- helpers ----------
function ensureDB(env) {
  if (!env?.DB) throw new Error("D1 binding env.DB is missing. Add it in wrangler.toml and your Pages/Worker bindings.");
}
function isAdmin(auth) {
  return (
    auth?.admin === true ||
    auth?.is_admin === true ||
    auth?.user?.role === "admin" ||
    auth?.claims?.is_admin === true
  );
}
function getOrgId(auth) {
  return (
    auth?.org_id ??
    auth?.orgId ??
    auth?.user?.org_id ??
    auth?.session?.org_id ??
    null
  );
}

async function ensureOrgBasics(env, org_id) {
  // Ensure 'Admin' role
  let { results: r1 } = await env.DB
    .prepare(`SELECT id FROM roles WHERE org_id = ? AND name = 'Admin'`)
    .bind(org_id).all();
  let adminRoleId = r1?.[0]?.id;
  if (!adminRoleId) {
    adminRoleId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO roles (id, org_id, name, description, is_admin, created_at, updated_at)
       VALUES (?, ?, 'Admin', 'Full access', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(adminRoleId, org_id).run();
  }

  // Ensure 'Member' role
  let { results: r2 } = await env.DB
    .prepare(`SELECT id FROM roles WHERE org_id = ? AND name = 'Member'`)
    .bind(org_id).all();
  let memberRoleId = r2?.[0]?.id;
  if (!memberRoleId) {
    memberRoleId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO roles (id, org_id, name, description, is_admin, created_at, updated_at)
       VALUES (?, ?, 'Member', 'Default member', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(memberRoleId, org_id).run();
  }

  // Ensure Admin has ALL permissions
  const { results: perms } = await env.DB
    .prepare(`SELECT id FROM permissions`).all();
  if (Array.isArray(perms) && perms.length) {
    const stmts = perms.map(p =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO role_permissions (role_id, permission_id, created_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)`
      ).bind(adminRoleId, p.id)
    );
    await env.DB.batch(stmts);
  }

  return { adminRoleId, memberRoleId };
}

// ---------- CORS / preflight ----------
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

// ---------- GET: list users in org (RAW ARRAY) ----------
export async function onRequestGet(ctx) {
  try {
    const { env, request } = ctx;
    ensureDB(env);

    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);

    const org_id = getOrgId(auth);
    if (!org_id) return json({ error: "missing org_id" }, 400);

    const { results } = await env.DB.prepare(
      `SELECT u.id, u.email, u.display_name,
              COALESCE(oum.is_owner, 0) AS is_owner
         FROM org_user_memberships oum
         JOIN users u ON u.id = oum.user_id
        WHERE oum.org_id = ?
        ORDER BY lower(u.display_name), lower(u.email)`
    ).bind(org_id).all();

    // raw array so arr.map(...) works
    return json(results ?? [], 200);
  } catch (e) {
    console.error("[users][GET] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}

// ---------- POST: create user + add to org + assign role ----------
export async function onRequestPost(ctx) {
  try {
    const { env, request } = ctx;
    ensureDB(env);

    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);
    if (!isAdmin(auth)) return json({ error: "forbidden" }, 403);

    const org_id = getOrgId(auth);
    if (!org_id) return json({ error: "missing org_id" }, 400);

    const body = await request.json().catch(() => null);
    const id = body?.id || crypto.randomUUID();
    const email = body?.email?.trim()?.toLowerCase?.() || null;
    const display_name = body?.display_name?.trim?.() || email || "New User";
    const make_admin = !!body?.admin;
    const group_ids = Array.isArray(body?.group_ids) ? body.group_ids : [];

    // Ensure baseline roles and Admin->all permissions
    const { adminRoleId, memberRoleId } = await ensureOrgBasics(env, org_id);

    // Build atomic batch
    const stmts = [
      env.DB.prepare(
        `INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(id, email, display_name),

      env.DB.prepare(
        `INSERT OR IGNORE INTO org_user_memberships (org_id, user_id, is_owner, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
      ).bind(org_id, id, make_admin ? 1 : 0),

      env.DB.prepare(
        `INSERT OR IGNORE INTO user_roles (org_id, user_id, role_id, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
      ).bind(org_id, id, make_admin ? adminRoleId : memberRoleId),
    ];

    // Optional: put them into groups
    for (const gid of group_ids) {
      if (!gid) continue;
      stmts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO user_groups (org_id, user_id, group_id, created_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
        ).bind(org_id, id, gid)
      );
    }

    await env.DB.batch(stmts);

    // Return the created user (org-scoped)
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.email, u.display_name,
              COALESCE(oum.is_owner, 0) AS is_owner
         FROM users u
         JOIN org_user_memberships oum
           ON oum.user_id = u.id AND oum.org_id = ?
        WHERE u.id = ?`
    ).bind(org_id, id).all();

    return json({ ok: true, user: results?.[0] ?? null }, 201);
  } catch (e) {
    console.error("[users][POST] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}
