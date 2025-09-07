// Cloudflare Pages Function: GET /api/admin/users.details
import { getAuthed, json } from "../../_lib/auth.js";

/* helpers */
function ensureDB(env) {
  if (!env?.DB) throw new Error("D1 binding env.DB is missing.");
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
function isAdmin(auth) {
  const role = auth?.role || auth?.user?.role || "";
  return (
    auth?.admin === true ||
    auth?.is_admin === true ||
    auth?.claims?.is_admin === true ||
    /^admin$/i.test(role)
  );
}

export async function onRequestGet({ request, env }) {
  try {
    ensureDB(env);

    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);

    const orgId = getOrgId(auth);
    if (!orgId) return json({ error: "missing org_id" }, 400);

    // Keep gate simple & robust (avoid dynamic import fragility)
    if (!isAdmin(auth)) return json({ error: "forbidden" }, 403);

    // Base users (NOTE: avatar column is avatar_url)
    const baseSql = `
      SELECT
        u.id,
        u.name,
        u.username,
        u.email,
        u.avatar_url,            -- ✅ correct column
        u.nickname,
        u.use_nickname,
        u.created_at,
        m.role      AS org_role,
        ur.role_id  AS role_id,
        r.name      AS role_name
      FROM user_orgs m
      JOIN users u
        ON u.id = m.user_id
      LEFT JOIN user_roles ur
        ON ur.org_id = m.org_id AND ur.user_id = u.id
      LEFT JOIN roles r
        ON r.id = ur.role_id
      WHERE m.org_id = ?1
      ORDER BY lower(COALESCE(u.name, u.email)) ASC, lower(u.email) ASC
    `;
    const { results: baseRows = [] } = await env.DB.prepare(baseSql).bind(orgId).all();
    if (!baseRows.length) return json([], 200);

    // Build a compact IN (...) list for subsequent lookups
    const userIds = baseRows.map(r => r.id);

    // Departments per user
    const depSql = `
      SELECT dm.user_id, d.id AS department_id, d.name AS department_name
      FROM department_members dm
      JOIN departments d ON d.id = dm.department_id
      WHERE d.org_id = ?1
        AND dm.user_id IN (${userIds.map(() => "?").join(",")})
    `;
    const { results: depRows = [] } = await env.DB.prepare(depSql).bind(orgId, ...userIds).all();

    // Groups per user
    const grpSql = `
      SELECT gm.user_id, g.id AS group_id, g.name AS group_name
      FROM group_members gm
      JOIN groups g ON g.id = gm.group_id
      WHERE g.org_id = ?1
        AND gm.user_id IN (${userIds.map(() => "?").join(",")})
    `;
    const { results: grpRows = [] } = await env.DB.prepare(grpSql).bind(orgId, ...userIds).all();

    // Permissions per user (flattened keys)
    const permSql = `
      SELECT ur.user_id, p.key AS perm_key
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p       ON p.id = rp.permission_id
      WHERE ur.org_id = ?1
        AND ur.user_id IN (${userIds.map(() => "?").join(",")})
    `;
    const { results: permRows = [] } = await env.DB.prepare(permSql).bind(orgId, ...userIds).all();

    // Index
    const depsByUser = new Map();
    for (const r of depRows) {
      const list = depsByUser.get(r.user_id) || [];
      list.push({ id: r.department_id, name: r.department_name });
      depsByUser.set(r.user_id, list);
    }

    const grpsByUser = new Map();
    for (const r of grpRows) {
      const list = grpsByUser.get(r.user_id) || [];
      list.push({ id: r.group_id, name: r.group_name });
      grpsByUser.set(r.user_id, list);
    }

    const permsByUser = new Map();
    for (const r of permRows) {
      const list = permsByUser.get(r.user_id) || [];
      list.push(r.perm_key);
      permsByUser.set(r.user_id, list);
    }

    // Output (permissions = flat keys)
    const out = baseRows.map(u => ({
      id: u.id,
      name: u.name,
      username: u.username,
      email: u.email,
      avatar_url: u.avatar_url || null,
      role: u.role_name || u.org_role || "Member",
      created_at: u.created_at,
      nickname: u.nickname,
      use_nickname: !!u.use_nickname,
      display_name: (u.use_nickname && u.nickname) ? u.nickname : (u.name || u.email),
      departments: depsByUser.get(u.id) || [],
      groups: grpsByUser.get(u.id) || [],
      permissions: permsByUser.get(u.id) || []
    }));

    return json(out, 200);
  } catch (err) {
    console.error("[users.details][GET] error:", err);
    return json({ error: "server_error", detail: String(err) }, 500);
  }
}
