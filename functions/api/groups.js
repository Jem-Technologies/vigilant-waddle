// functions/api/groups.js
export async function onRequestPost(ctx){ return createGroup(ctx); }
export async function onRequestGet(ctx){ return listGroups(ctx); }


import { getAuthed, json } from "../_lib/auth.js";
import { broadcast } from "../_lib/orgHub.js";


async function createGroup({ request, env }){
const auth = await getAuthed(env, request);
if (!auth.ok) return json({ error:"unauthorized" }, 401);
const body = await request.json().catch(()=>null);
if (!body?.department_id || !body?.name) return json({ error:"department_id and name required" }, 400);
if (auth.role !== "Admin"){
const gate = await env.DB.prepare(`SELECT can_create_groups FROM department_members WHERE user_id=?1 AND department_id=?2`).bind(auth.userId, body.department_id).first();
if (!gate?.can_create_groups) return json({ error:"forbidden" }, 403);
}
const id = crypto.randomUUID();
await env.DB.prepare(`INSERT INTO groups (id, org_id, department_id, name, created_by) VALUES (?1, ?2, ?3, ?4, ?5)`)
.bind(id, auth.orgId, body.department_id, body.name, auth.userId).run();
await broadcast(env, auth.orgSlug, { type:"group.created", id, name: body.name, department_id: body.department_id });
return json({ id, name: body.name });
}


async function listGroups({ request, env }){
const auth = await getAuthed(env, request);
if (!auth.ok) return json({ error:"unauthorized" }, 401);
const url = new URL(request.url);
const dep = url.searchParams.get("department_id");
if (auth.role === "Admin"){
const q = dep
? `SELECT id, name, department_id FROM groups WHERE org_id=?1 AND department_id=?2 ORDER BY name`
: `SELECT id, name, department_id FROM groups WHERE org_id=?1 ORDER BY name`;
const rows = dep
? await env.DB.prepare(q).bind(auth.orgId, dep).all()
: await env.DB.prepare(q).bind(auth.orgId).all();
return json(rows.results || []);
}
// Non-admin: only groups they belong to (or within departments they belong to)
const rows = dep
? await env.DB.prepare(`
SELECT g.id, g.name, g.department_id
FROM groups g
JOIN group_members gm ON gm.group_id=g.id AND gm.user_id=?1
WHERE g.org_id=?2 AND g.department_id=?3
ORDER BY g.name
`).bind(auth.userId, auth.orgId, dep).all()
: await env.DB.prepare(`
SELECT g.id, g.name, g.department_id
FROM groups g
JOIN group_members gm ON gm.group_id=g.id AND gm.user_id=?1
WHERE g.org_id=?2
ORDER BY g.name
`).bind(auth.userId, auth.orgId).all();
return json(rows.results || []);
}