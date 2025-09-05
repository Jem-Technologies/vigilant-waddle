// functions/api/messages.js
export async function onRequestPost(ctx){ return createMessage(ctx); }
export async function onRequestGet(ctx){ return listMessages(ctx); }


import { getAuthed, json } from "../_lib/auth.js";
import { broadcast } from "../_lib/orgHub.js";


async function createMessage({ request, env }){
const auth = await getAuthed(env, request);
if (!auth.ok) return json({ error:"unauthorized" }, 401);
const body = await request.json().catch(()=>null);
if (!body?.thread_id || !body?.kind) return json({ error:"thread_id and kind required" }, 400);
const t = await env.DB.prepare(`SELECT department_id, group_id FROM threads WHERE id=?1 AND org_id=?2`).bind(body.thread_id, auth.orgId).first();
if (!t) return json({ error:"thread_not_found" }, 404);
if (auth.role !== "Admin"){
if (t.department_id){
const m = await env.DB.prepare(`SELECT 1 FROM department_members WHERE user_id=?1 AND department_id=?2`).bind(auth.userId, t.department_id).first();
if (!m) return json({ error:"forbidden" }, 403);
} else if (t.group_id){
const m = await env.DB.prepare(`SELECT 1 FROM group_members WHERE user_id=?1 AND group_id=?2`).bind(auth.userId, t.group_id).first();
if (!m) return json({ error:"forbidden" }, 403);
}
}
const id = crypto.randomUUID();
const now = new Date().toISOString();
await env.DB.prepare(`INSERT INTO messages (id, thread_id, sender_id, kind, body, media_url, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
.bind(id, body.thread_id, auth.userId, body.kind, body.body ? JSON.stringify(body.body) : null, body.media_url || null, now).run();
await broadcast(env, auth.orgSlug, { type:"message.new", id, thread_id: body.thread_id, kind: body.kind, body: body.body || null, media_url: body.media_url || null, created_at: now, sender_id: auth.userId });
return json({ id, created_at: now });
}


async function listMessages({ request, env }){
const auth = await getAuthed(env, request);
if (!auth.ok) return json({ error:"unauthorized" }, 401);
const url = new URL(request.url);
const threadId = url.searchParams.get("thread_id");
const before = url.searchParams.get("before"); // ISO cursor (optional)
const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")||50)));
if (!threadId) return json({ error:"thread_id required" }, 400);
const t = await env.DB.prepare(`SELECT department_id, group_id FROM threads WHERE id=?1 AND org_id=?2`).bind(threadId, auth.orgId).first();
if (!t) return json({ error:"thread_not_found" }, 404);
if (auth.role !== "Admin"){
if (t.department_id){
const m = await env.DB.prepare(`SELECT 1 FROM department_members WHERE user_id=?1 AND department_id=?2`).bind(auth.userId, t.department_id).first();
if (!m) return json({ error:"forbidden" }, 403);
} else if (t.group_id){
const m = await env.DB.prepare(`SELECT 1 FROM group_members WHERE user_id=?1 AND group_id=?2`).bind(auth.userId, t.group_id).first();
if (!m) return json({ error:"forbidden" }, 403);
}
}
const rows = before
? await env.DB.prepare(`SELECT id, sender_id, kind, body, media_url, created_at FROM messages WHERE thread_id=?1 AND created_at<?2 ORDER BY created_at DESC LIMIT ?3`)
.bind(threadId, before, limit).all()
: await env.DB.prepare(`SELECT id, sender_id, kind, body, media_url, created_at FROM messages WHERE thread_id=?1 ORDER BY created_at DESC LIMIT ?2`)
.bind(threadId, limit).all();
// Return in ascending time for UI
const list = (rows.results||[]).slice().reverse();
const nextCursor = list.length ? list[0].created_at : null; // for back-scroll
return json({ messages: list, nextCursor });
}