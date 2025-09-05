// functions/api/groups.js
import { getAuthed, json } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error: "unauthorized" }, 401);

  const rows = await env.DB.prepare(`
    SELECT g.id, g.name, g.org_id, g.department_id, g.created_at,
           d.name AS department_name,
           (SELECT COUNT(1) FROM group_members gm WHERE gm.group_id=g.id) AS member_count,
           (SELECT COUNT(1) FROM threads t WHERE t.group_id=g.id)        AS thread_count
    FROM groups g
    LEFT JOIN departments d ON d.id=g.department_id
    WHERE g.org_id=?1
    ORDER BY d.name, g.name
  `).bind(auth.orgId).all();

  return json(rows.results || []);
}

export async function onRequestPost({ request, env }) {
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error: "unauthorized" }, 401);

  // permission: create group
  let hasPerm = null;
  try { ({ hasPerm } = await import("../_lib/perm.js")); } catch {}
  const role = auth.role || auth.user?.role;
  if (hasPerm ? !hasPerm({ role }, "groups.create") : (role !== "Admin" && role !== "Manager")) {
    return json({ error: "forbidden" }, 403);
  }

  const body = await request.json().catch(() => null);
  const name = body?.name?.trim();
  const department_id = body?.department_id?.trim();
  if (!name || !department_id) return json({ error: "name_and_department_required" }, 400);

  // verify department belongs to org
  const dep = await env.DB.prepare(`SELECT id FROM departments WHERE id=?1 AND org_id=?2`)
    .bind(department_id, auth.orgId).first();
  if (!dep) return json({ error: "bad_department" }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB
    .prepare(`INSERT INTO groups (id, org_id, department_id, name, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(id, auth.orgId, department_id, name, now).run();

  return json({ id, name, department_id, created_at: now });
}

export async function onRequestDelete({ request, env }) {
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error: "unauthorized" }, 401);

  // permission: delete group
  let hasPerm = null;
  try { ({ hasPerm } = await import("../_lib/perm.js")); } catch {}
  const role = auth.role || auth.user?.role;
  if (hasPerm ? !hasPerm({ role }, "groups.delete") : (role !== "Admin")) {
    return json({ error: "forbidden" }, 403);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return json({ error: "id_required" }, 400);

  // safety checks
  const check = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(1) FROM group_members gm WHERE gm.group_id=?1) AS member_count,
      (SELECT COUNT(1) FROM threads t WHERE t.group_id=?1)        AS thread_count
  `).bind(id).first();

  if (!check) return json({ error: "not_found" }, 404);

  if (check.member_count > 0 || check.thread_count > 0) {
    return json({
      error: "conflict",
      detail: "Group has linked threads/members. Remove or move them first."
    }, 409);
  }

  await env.DB.prepare(`DELETE FROM groups WHERE id=?1 AND org_id=?2`)
    .bind(id, auth.orgId).run();

  return json({ ok: true, id });
}
