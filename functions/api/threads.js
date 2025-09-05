// functions/api/threads.js
export async function onRequestPost(ctx){ return createThread(ctx); }
export async function onRequestGet(ctx){ return listThreads(ctx); }


import { getAuthed, json } from "../_lib/auth.js";
import { broadcast } from "../_lib/orgHub.js";


async function createThread({ request, env }){
const auth = await getAuthed(env, request);
if (!auth.ok) return json({ error:"unauthorized" }, 401);
const body = await request.json().catch(()=>null);
const dep = !!body?.department_id, grp = !!body?.group_id;
if (!(dep ^ grp)) return json({ error:"thread must target department OR group" }, 400);
if (auth.role !== "Admin"){
if (dep){
const m = await env.DB.prepare(`SELECT 1 FROM department_members WHERE user_id=?1 AND department_id=?2`).bind(auth.userId, body.department_id).first();
if (!m) return json({ error:"forbidden" }, 403);
} else {
const m = await env.DB.prepare(`SELECT 1 FROM group_members WHERE user_id=?1 AND group_id=?2`).bind(auth.userId, body.group_id).first();
if (!m) return json({ error:"forbidden" }, 403);
}
}
const id = crypto.randomUUID();
await env.DB.prepare(`INSERT INTO threads (id, org_id, department_id, group_id, title, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
.bind(id, auth.orgId, body.department_id || null, body.group_id || null, body.title || null, auth.userId).run();
await broadcast(env, auth.orgSlug, { type:"thread.created", id, department_id: body.department_id || null, group_id: body.group_id || null, title: body.title || null });
return json({ id });
}


async function listThreads({ request, env }){
const auth = await getAuthed(env, request);
if (!auth.ok) return json({ error:"unauthorized" }, 401);
const url = new URL(request.url);
const dep = url.searchParams.get("department_id");
const grp = url.searchParams.get("group_id");
if (!!dep === !!grp) return json({ error:"provide exactly one of department_id or group_id" }, 400);


if (auth.role !== "Admin"){
if (dep){
const m = await env.DB.prepare(`SELECT 1 FROM department_members WHERE user_id=?1 AND department_id=?2`).bind(auth.userId, dep).first();
if (!m) return json({ error:"forbidden" }, 403);
} else {
const m = await env.DB.prepare(`SELECT 1 FROM group_members WHERE user_id=?1 AND group_id=?2`).bind(auth.userId, grp).first();
if (!m) return json({ error:"forbidden" }, 403);
}
}


const rows = dep
? await env.DB.prepare(`SELECT id, title, created_at FROM threads WHERE org_id=?1 AND department_id=?2 ORDER BY created_at DESC`).bind(auth.orgId, dep).all()
: await env.DB.prepare(`SELECT id, title, created_at FROM threads WHERE org_id=?1 AND group_id=?2 ORDER BY created_at DESC`).bind(auth.orgId, grp).all();
return json(rows.results || []);
}