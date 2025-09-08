// Cloudflare Pages Function: GET /api/admin/users.details
import { getAuthed, json } from "../../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);

    // Permission check
    let hasPerm = null;
    try {
      const mod = await import("../../_lib/perm.js");
      hasPerm = mod.hasPerm;
    } catch {
      hasPerm = (ctx, perm) => /^(Admin|Owner)$/i.test(ctx?.role || auth?.role);
    }
    const orgRole = auth.role || auth.user?.role || null;
    if (!hasPerm({ role: orgRole }, "users.read.all")) {
      return json({ error: "forbidden" }, 403);
    }

    // Base users in org
    const base = await env.DB.prepare(`
      SELECT u.id, u.name, u.username, u.email,
             u.avatar_url AS avatar_url,
             u.nickname, u.use_nickname, u.created_at,
             COALESCE(r.name, m.role, 'Member') AS role,
             ur.role_id AS role_id
        FROM user_orgs m
        JOIN users u ON u.id = m.user_id
        LEFT JOIN user_roles ur
          ON ur.org_id = m.org_id AND ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
       WHERE m.org_id = ?1
       ORDER BY u.name
    `).bind(auth.orgId).all();

    const users = base?.results || [];
    if (!users.length) return json([]);

    // Departments
    const depRows = await env.DB.prepare(`
      SELECT dm.user_id, d.id AS department_id, d.name AS department_name
        FROM department_members dm
        JOIN departments d ON d.id = dm.department_id
       WHERE d.org_id = ?1
    `).bind(auth.orgId).all();

    // Groups
    const grpRows = await env.DB.prepare(`
      SELECT gm.user_id, g.id AS group_id, g.name AS group_name
        FROM group_members gm
        JOIN groups g ON g.id = gm.group_id
       WHERE g.org_id = ?1
    `).bind(auth.orgId).all();

    // Permissions per user (flattened keys)
    const permRows = await env.DB.prepare(`
      SELECT ur.user_id, p.key AS perm_key
        FROM user_roles ur
        JOIN role_permissions rp ON rp.role_id = ur.role_id
        JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.org_id = ?1
    `).bind(auth.orgId).all();

    // Indexing
    const depsByUser = new Map();
    for (const r of (depRows?.results || [])) {
      const list = depsByUser.get(r.user_id) || [];
      list.push({ id: r.department_id, name: r.department_name });
      depsByUser.set(r.user_id, list);
    }

    const grpsByUser = new Map();
    for (const r of (grpRows?.results || [])) {
      const list = grpsByUser.get(r.user_id) || [];
      list.push({ id: r.group_id, name: r.group_name });
      grpsByUser.set(r.user_id, list);
    }

    const permsByUser = new Map();
    for (const r of (permRows?.results || [])) {
      const list = permsByUser.get(r.user_id) || [];
      list.push(r.perm_key); // only the key
      permsByUser.set(r.user_id, list);
    }

    // Final output
    const out = users.map(u => ({
      id: u.id,
      name: u.name,
      username: u.username,
      email: u.email,
      avatar_url: u.avatar_url,
      role: u.role,
      created_at: u.created_at,
      nickname: u.nickname,
      use_nickname: !!u.use_nickname,
      display_name: (u.use_nickname && u.nickname ? u.nickname : u.name),
      departments: depsByUser.get(u.id) || [],
      groups: grpsByUser.get(u.id) || [],
      permissions: permsByUser.get(u.id) || []  // ← just array of keys
    }));

    return json(out, 200);
  } catch (err) {
    return json({ error: "server_error", detail: String(err) }, 500);
  }
}
