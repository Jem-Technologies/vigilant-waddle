// functions/api/admin/users.details.js
// Cloudflare Pages Functions: GET /api/admin/users.details
// Returns enriched user rows for the current org:
// avatar, name, username, email, role, departments[], groups[], nickname/use_nickname,
// display_name, permissions[] (derived from role).

import { getAuthed, json } from "../../_lib/auth.js";
import { hasPerm, rolePerms } from "../../_lib/perm.js";

export async function onRequestGet({ request, env }) {
  try {
    // 1) Auth & org context
    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);

    // Require org-wide user listing permission
    if (!hasPerm(auth, "users.read.all")) {
      return json({ error: "forbidden" }, 403);
    }

    // 2) Base user rows (scoped to org)
    const base = await env.DB.prepare(`
      SELECT
        u.id, u.name, u.username, u.email, u.avatar_url,
        u.nickname, u.use_nickname, u.created_at,
        m.role
      FROM user_orgs m
      JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ?1
      ORDER BY u.name
    `).bind(auth.orgId).all();

    const users = base?.results || [];
    if (users.length === 0) return json([]);

    // 3) Department memberships (per user)
    const depRows = await env.DB.prepare(`
      SELECT dm.user_id, d.id AS department_id, d.name AS department_name
      FROM department_members dm
      JOIN departments d ON d.id = dm.department_id
      WHERE d.org_id = ?1
    `).bind(auth.orgId).all();

    // 4) Group memberships (per user)
    const grpRows = await env.DB.prepare(`
      SELECT gm.user_id, g.id AS group_id, g.name AS group_name
      FROM group_members gm
      JOIN groups g ON g.id = gm.group_id
      WHERE g.org_id = ?1
    `).bind(auth.orgId).all();

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

    // 5) Shape response
    const out = users.map(u => {
      const display_name =
        (u.use_nickname ? u.nickname : null) && String(u.nickname).trim() !== ""
          ? u.nickname
          : u.name;

      return {
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        avatar_url: u.avatar_url,
        role: u.role,
        created_at: u.created_at,
        nickname: u.nickname,
        use_nickname: !!u.use_nickname,
        display_name,
        departments: depsByUser.get(u.id) || [],
        groups: grpsByUser.get(u.id) || [],
        permissions: rolePerms(u.role) // derived from role via _lib/perm.js
      };
    });

    return json(out, 200);
  } catch (err) {
    // Surface a concise error for easier debugging in dev; avoid leaking details in prod if needed
    return json({ error: "server_error", detail: String(err?.message || err) }, 500);
  }
}
