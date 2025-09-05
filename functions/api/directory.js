// functions/api/directory.js
import { getAuthed, json } from "../_lib/auth.js";
export async function onRequestGet({ request, env }) {
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error:"unauthorized" }, 401);
  const rows = await env.DB.prepare(`
    WITH my_deps AS (SELECT department_id AS id FROM department_members WHERE user_id=?1),
         my_grps AS (SELECT group_id AS id FROM group_members WHERE user_id=?1)
    SELECT DISTINCT u.id, u.name, u.username, u.email, u.avatar_url
      FROM users u
      JOIN user_orgs m ON m.user_id=u.id AND m.org_id=?2
     WHERE u.id != ?1 AND (
       EXISTS (SELECT 1 FROM department_members dm WHERE dm.user_id=u.id AND dm.department_id IN (SELECT id FROM my_deps))
       OR EXISTS (SELECT 1 FROM group_members gm WHERE gm.user_id=u.id AND gm.group_id IN (SELECT id FROM my_grps))
     )
     ORDER BY u.name
  `).bind(auth.userId, auth.orgId).all();
  return json(rows.results || []);
}