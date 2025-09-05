// functions/api/admin/users.details.js
import { getAuthed, json } from "../../_lib/auth.js";

function ensureDB(env) {
  if (!env?.DB) throw new Error("D1 binding env.DB missing. Add it in wrangler.toml.");
}
const isAdminRole = v => !!v; // D1 stores booleans as 0/1

export async function onRequestGet(ctx) {
  try {
    const { env, request } = ctx;
    ensureDB(env);

    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);

    const org_id =
      auth?.org_id ?? auth?.orgId ?? auth?.user?.org_id ?? auth?.session?.org_id ?? null;
    if (!org_id) return json({ error: "missing org_id" }, 400);

    // 1) All users in this org (drives the list)
    const { results: users } = await env.DB.prepare(
      `SELECT u.id, u.email, u.display_name
         FROM org_user_memberships oum
         JOIN users u ON u.id = oum.user_id
        WHERE oum.org_id = ?
        ORDER BY lower(u.display_name), lower(u.email)`
    ).bind(org_id).all();

    if (!users?.length) return json([], 200);

    // Pre-fetch maps (fewer round-trips)
    const { results: rolesDirect } = await env.DB.prepare(
      `SELECT ur.user_id, r.name, r.is_admin
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id AND r.org_id = ur.org_id
        WHERE ur.org_id = ?`
    ).bind(org_id).all();

    const { results: rolesViaGroups } = await env.DB.prepare(
      `SELECT ug.user_id, r.name, r.is_admin
         FROM user_groups ug
         JOIN group_roles gr ON gr.group_id = ug.group_id AND gr.org_id = ug.org_id
         JOIN roles r ON r.id = gr.role_id AND r.org_id = gr.org_id
        WHERE ug.org_id = ?`
    ).bind(org_id).all();

    const { results: groups } = await env.DB.prepare(
      `SELECT ug.user_id, g.id AS id, g.name AS name
         FROM user_groups ug
         JOIN groups g ON g.id = ug.group_id AND g.org_id = ug.org_id
        WHERE ug.org_id = ?
        ORDER BY g.name`
    ).bind(org_id).all();

    const { results: depts } = await env.DB.prepare(
      `SELECT dm.user_id, d.id AS id, d.name AS name
         FROM department_members dm
         JOIN departments d ON d.id = dm.department_id AND d.org_id = dm.org_id
        WHERE dm.org_id = ?
        ORDER BY d.name`
    ).bind(org_id).all();

    // Try view for permissions; fall back if missing
    let perms = [];
    try {
      perms = (await env.DB.prepare(
        `SELECT user_id, code FROM v_effective_user_permissions WHERE org_id = ?`
      ).bind(org_id).all()).results ?? [];
    } catch {
      const tmp = (await env.DB.prepare(
        `SELECT DISTINCT p.code, x.user_id
           FROM permissions p
           JOIN role_permissions rp ON rp.permission_id = p.id
           JOIN (
                 SELECT ur.user_id, ur.role_id FROM user_roles ur WHERE ur.org_id = ?
                 UNION
                 SELECT ug.user_id, gr.role_id
                   FROM user_groups ug
                   JOIN group_roles gr ON gr.group_id = ug.group_id AND gr.org_id = ug.org_id
                  WHERE ug.org_id = ?
           ) x ON x.role_id = rp.role_id`
      ).bind(org_id, org_id).all()).results ?? [];
      perms = tmp;
    }

    // Index by user_id
    const gByU = new Map();
    for (const g of groups || []) {
      if (!gByU.has(g.user_id)) gByU.set(g.user_id, []);
      gByU.get(g.user_id).push({ id: g.id, name: g.name });
    }
    const dByU = new Map();
    for (const d of depts || []) {
      if (!dByU.has(d.user_id)) dByU.set(d.user_id, []);
      dByU.get(d.user_id).push({ id: d.id, name: d.name });
    }
    const pByU = new Map();
    for (const p of perms || []) {
      if (!pByU.has(p.user_id)) pByU.set(p.user_id, new Set());
      pByU.get(p.user_id).add(p.code);
    }
    const adminByU = new Map();
    for (const r of rolesDirect || []) {
      if (!adminByU.has(r.user_id)) adminByU.set(r.user_id, false);
      adminByU.set(r.user_id, adminByU.get(r.user_id) || isAdminRole(r.is_admin));
    }
    for (const r of rolesViaGroups || []) {
      if (!adminByU.has(r.user_id)) adminByU.set(r.user_id, false);
      adminByU.set(r.user_id, adminByU.get(r.user_id) || isAdminRole(r.is_admin));
    }

    // Build array the UI expects
    const out = users.map(u => {
      const name = u.display_name || u.email || "User";
      const role = adminByU.get(u.id) ? "Admin" : "Member";
      return {
        id: u.id,
        name,
        email: u.email,
        username: null,
        role,
        departments: dByU.get(u.id) || [],
        groups: gByU.get(u.id) || [],
        nickname: null, // optional, if you later add a user_prefs table
        avatar_url: null, // optional CDN path if you store avatars
        permissions: Array.from(pByU.get(u.id) || []),
      };
    });

    return json(out, 200);
  } catch (e) {
    console.error("[admin/users.details][GET] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}
