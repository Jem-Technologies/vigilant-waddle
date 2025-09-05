// functions/api/admin/users.details.js
import { getAuthed, json } from "../../_lib/auth.js";
import { rolePerms } from "../../_lib/perm.js";

export async function onRequestGet({ request, env }) {
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error:"unauthorized" }, 401);

  // Require users.read.all (Admin has it; Managers do, too, in our map)
  const { hasPerm } = await import("../../_lib/perm.js");
  if (!hasPerm(auth, "users.read.all")) return json({ error:"forbidden" }, 403);

  // Base user rows scoped to org
  const base = await env.DB.prepare(`
    SELECT u.id, u.name, u.username, u.email, u.avatar_url, u.nickname, u.use_nickname,
           m.role, u.created_at
      FROM user_orgs m
      JOIN users u ON u.id=m.user_id
     WHERE m.org_id=?1
     ORDER BY u.name
  `).bind(auth.orgId).all();

  const users = base.results || [];
  if (!users.length) return json([]);

  // Aggregate departments per user
  const depRows = await env.DB.prepare(`
    SELECT dm.user_id, d.id AS department_id, d.name AS department_name
      FROM department_members dm
      JOIN departments d ON d.id=dm.department_id
     WHERE d.org_id=?1
  `).bind(auth.orgId).all();

  // Aggregate groups per user
  const grpRows = await env.DB.prepare(`
    SELECT gm.user_id, g.id AS group_id, g.name AS group_name
      FROM group_members gm
      JOIN groups g ON g.id=gm.group_id
     WHERE g.org_id=?1
  `).bind(auth.orgId).all();

  const depsByUser = new Map();
  (depRows.results || []).forEach(r => {
    const arr = depsByUser.get(r.user_id) || [];
    arr.push({ id: r.department_id, name: r.department_name });
    depsByUser.set(r.user_id, arr);
  });

  const grpsByUser = new Map();
  (grpRows.results || []).forEach(r => {
    const arr = grpsByUser.get(r.user_id) || [];
    arr.push({ id: r.group_id, name: r.group_name });
    grpsByUser.set(r.user_id, arr);
  });

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
    display_name: (u.use_nickname && u.nickname) ? u.nickname : u.name,
    departments: depsByUser.get(u.id) || [],
    groups: grpsByUser.get(u.id) || [],
    permissions: rolePerms(u.role)
  }));

  return json(out);
}
