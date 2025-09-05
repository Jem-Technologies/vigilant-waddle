// Cloudflare Pages Function: GET /api/admin/users.details
import { getAuthed, json } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);

    // Try to import perm helpers; if import fails, fall back to role==='Admin'
    let hasPerm = null, rolePerms = null;
    try {
      const mod = await import("../_lib/perm.js");
      hasPerm = mod.hasPerm;
      rolePerms = mod.rolePerms;
    } catch (e) {
      hasPerm = (ctx, perm) => (ctx?.role || auth?.role || auth?.user?.role) === "Admin";
      rolePerms = (role) => role === "Admin" ? [
        "users.create","users.edit","users.delete","users.disable","users.read.all","users.read.details",
        "groups.create","groups.edit","groups.delete","groups.read",
        "messages.delete","messages.pin","files.manage","polls.create","events.create",
        "system.settings.manage","system.audit.view","system.permissions.manage","system.reports.export"
      ] : [];
    }

    // Ensure auth has a role field
    const orgRole = auth.role || auth.user?.role || auth?.userRole || null;
    const authCtx = { role: orgRole };

    if (!hasPerm(authCtx, "users.read.all")) {
      return json({ error: "forbidden" }, 403);
    }

    // Base users in org
    let base;
    try {
      base = await env.DB.prepare(`
        SELECT u.id, u.name, u.username, u.email, u.avatar_url,
               u.nickname, u.use_nickname, u.created_at,
               m.role
          FROM user_orgs m
          JOIN users u ON u.id = m.user_id
         WHERE m.org_id = ?1
         ORDER BY u.name
      `).bind(auth.orgId).all();
    } catch (e) {
      return json({ error: "db_error", where: "base_users", detail: String(e) }, 500);
    }
    const users = base?.results || [];
    if (!users.length) return json([]);

    // Departments per user
    let depRows;
    try {
      depRows = await env.DB.prepare(`
        SELECT dm.user_id, d.id AS department_id, d.name AS department_name
          FROM department_members dm
          JOIN departments d ON d.id = dm.department_id
         WHERE d.org_id = ?1
      `).bind(auth.orgId).all();
    } catch (e) {
      return json({ error: "db_error", where: "department_members", detail: String(e) }, 500);
    }

    // Groups per user
    let grpRows;
    try {
      grpRows = await env.DB.prepare(`
        SELECT gm.user_id, g.id AS group_id, g.name AS group_name
          FROM group_members gm
          JOIN groups g ON g.id = gm.group_id
         WHERE g.org_id = ?1
      `).bind(auth.orgId).all();
    } catch (e) {
      return json({ error: "db_error", where: "group_members", detail: String(e) }, 500);
    }

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
      permissions: rolePerms ? rolePerms(u.role) : []
    }));

    return json(out, 200);
  } catch (err) {
    return json({ error: "server_error", detail: String(err) }, 500);
  }
}
