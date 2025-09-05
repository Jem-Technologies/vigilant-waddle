export async function onRequestPost({ request, env }){
  const { getAuthed, json } = await import("../_lib/auth.js");
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error: "unauthorized" }, 401);

  const body = await request.json().catch(()=>null);
  if (!body?.thread_id) return json({ error:"thread_id required" }, 400);

  const ts = body.last_seen_at || new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO message_reads (org_id, thread_id, user_id, last_seen_at)
    VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(org_id, thread_id, user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at
  `).bind(auth.orgId, body.thread_id, auth.userId, ts).run();

  return json({ ok: true });
}
