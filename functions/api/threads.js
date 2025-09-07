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
           WHERE t.department_id = ?1 AND t.org_id = ?2
           ORDER BY t.created_at DESC
       `).bind(depId, auth.orgId).all();
       return json(rows.results || []);
     }
     if (grpId) {
       const rows = await env.DB.prepare(`
         SELECT t.id, t.title, t.department_id, t.group_id, t.created_at
           FROM threads t
           WHERE t.group_id = ?1 AND t.org_id = ?2
           ORDER BY t.created_at DESC
       `).bind(grpId, auth.orgId).all();
       return json(rows.results || []);
     }

    // Admin sees everything in the org
    if (auth.role === 'Admin') {
      const rows = await env.DB.prepare(`
        SELECT t.id, t.title, t.department_id, t.group_id, t.created_at
          FROM threads t
         WHERE t.org_id = ?1
         ORDER BY t.created_at DESC
      `).bind(auth.orgId).all();
      return json(rows.results || []);
    }

    // Otherwise, only threads where the user is a member (dept or group)
     const rows = await env.DB.prepare(`
       WITH my_deps AS (
         SELECT department_id FROM department_members WHERE user_id = ?1
       ),
       my_grps AS (
         SELECT group_id FROM group_members WHERE user_id = ?1
       )
       SELECT t.id, t.title, t.department_id, t.group_id, t.created_at
         FROM threads t
        WHERE t.org_id=?2
          AND (
            (t.department_id IS NOT NULL AND t.department_id IN (SELECT department_id FROM my_deps))
            OR
            (t.group_id IS NOT NULL AND t.group_id IN (SELECT group_id FROM my_grps))
          )
        ORDER BY t.created_at DESC
     `).bind(auth.userId, auth.orgId).all();
 
     return json(rows.results || []);
   } catch (err) {
     return json({ error:"server_error", detail:String(err) }, 500);
   }
 }
