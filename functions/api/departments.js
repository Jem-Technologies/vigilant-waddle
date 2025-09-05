export async function onRequestPost(ctx){ return createDepartment(ctx); }
export async function onRequestGet(ctx){ return listDepartments(ctx); }


import { getAuthed, json, requireAdmin } from "../_lib/auth.js";
import { broadcast } from "../_lib/orgHub.js";


async function createDepartment({ request, env }){
const auth = await getAuthed(env, request);
const gate = requireAdmin(auth);
if (gate) return json({ error: gate }, gate==="forbidden"?403:401);
const body = await request.json().catch(()=>null);
if (!body?.name) return json({ error:"name required" }, 400);
const id = crypto.randomUUID();
await env.DB.prepare(`INSERT INTO departments (id, org_id, name, created_by) VALUES (?1, ?2, ?3, ?4)`)
.bind(id, auth.orgId, body.name, auth.userId).run();
await broadcast(env, auth.orgSlug, { type:"department.created", id, name: body.name });
return json({ id, name: body.name });
}


async function listDepartments({ request, env }){
const auth = await getAuthed(env, request);
if (!auth.ok) return json({ error:"unauthorized" }, 401);
if (auth.role === "Admin"){
const rows = await env.DB.prepare(`SELECT id, name FROM departments WHERE org_id=?1 ORDER BY name`).bind(auth.orgId).all();
return json(rows.results || []);
}
const rows = await env.DB.prepare(`
SELECT d.id, d.name
FROM departments d
JOIN department_members m ON m.department_id=d.id AND m.user_id=?1
WHERE d.org_id=?2
ORDER BY d.name
`).bind(auth.userId, auth.orgId).all();
return json(rows.results || []);
}