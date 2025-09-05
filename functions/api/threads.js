import { getAuthed, json } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error:"unauthorized" }, 401);

    const { searchParams } = new URL(request.url);
    const depId = searchParams.get("department_id");
    const grpId = searchParams.get("group_id");

    // If a filter is provided, return threads for that parent.
    if (depId) {
      const rows = await env.DB.prepare(`
        SELECT t.id, t.title, t.department_id, t.group_id, t.created_at
          FROM threads t
         WHERE t.org_id=?1 AND t.department_id=?2
         ORDER BY t.created_at DESC
      `).bind(auth.orgId, depId).all();
      return json(rows.results || []);
    }
    if (grpId) {
      const rows = await env.DB.prepare(`
        SELECT t.id, t.title, t.department_id, t.group_id, t.created_at
          FROM threads t
         WHERE t.org_id=?1 AND t.group_id=?2
         ORDER BY t.created_at DESC
      `).bind(auth.orgId, grpId).all();
      return json(rows.results || []);
    }

    // No filters: return threads visible to the user via dept or group membership.
    const rows = await env.DB.prepare(`
      WITH my_deps AS (
        SELECT department_id AS id FROM department_members WHERE user_id=?1
      ),
      my_grps AS (
        SELECT group_id AS id FROM group_members WHERE user_id=?1
      )
      SELECT DISTINCT t.id, t.title, t.department_id, t.group_id, t.created_at
        FROM threads t
       WHERE t.org_id=?2
         AND (
           (t.department_id IS NOT NULL AND t.department_id IN (SELECT id FROM my_deps))
           OR
           (t.group_id IS NOT NULL AND t.group_id IN (SELECT id FROM my_grps))
         )
       ORDER BY t.created_at DESC
    `).bind(auth.userId, auth.orgId).all();

    return json(rows.results || []);
  } catch (err) {
    return json({ error:"server_error", detail:String(err) }, 500);
  }
}
