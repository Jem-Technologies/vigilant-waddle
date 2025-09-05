// functions/api/departments.js
import { getAuthed, json } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error: "unauthorized" }, 401);

  const rows = await env.DB.prepare(`
    SELECT d.id, d.name, d.org_id, d.created_at,
           (SELECT COUNT(1) FROM groups g WHERE g.department_id=d.id)       AS group_count,
           (SELECT COUNT(1) FROM threads t WHERE t.department_id=d.id)      AS thread_count,
           (SELECT COUNT(1) FROM department_members dm WHERE dm.department_id=d.id) AS member_count
    FROM departments d
    WHERE d.org_id=?1
    ORDER BY d.name
  `).bind(auth.orgId).all();

  return json(rows.results || []);
}

export async function onRequestPost({ request, env }) {
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error: "unauthorized" }, 401);

  // permission: create department
  let hasPerm = null;
  try { ({ hasPerm } = await import("../_lib/perm.js")); } catch {}
  const role = auth.role || auth.user?.role;
  if (hasPerm ? !hasPerm({ role }, "groups.create") : (role !== "Admin" && role !== "Manager")) {
    return json({ error: "forbidden" }, 403);
  }

  const body = await request.json().catch(() => null);
  const name = body?.name?.trim();
  if (!name) return json({ error: "name_required" }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB
    .prepare(`INSERT INTO departments (id, org_id, name, created_at) VALUES (?1, ?2, ?3, ?4)`)
    .bind(id, auth.orgId, name, now).run();

  return json({ id, name, created_at: now });
}

export async function onRequestDelete({ request, env }) {
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error: "unauthorized" }, 401);

  // permission: delete department
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
      (SELECT COUNT(1) FROM groups g WHERE g.department_id=?1)       AS group_count,
      (SELECT COUNT(1) FROM threads t WHERE t.department_id=?1)      AS thread_count,
      (SELECT COUNT(1) FROM department_members dm WHERE dm.department_id=?1) AS member_count
  `).bind(id).first();

  if (!check) return json({ error: "not_found" }, 404);

  if (check.group_count > 0 || check.thread_count > 0 || check.member_count > 0) {
    return json({
      error: "conflict",
      detail: "Department has linked groups/threads/members. Remove or move them first."
    }, 409);
  }

  await env.DB.prepare(`DELETE FROM departments WHERE id=?1 AND org_id=?2`)
    .bind(id, auth.orgId).run();

  return json({ ok: true, id });
}
