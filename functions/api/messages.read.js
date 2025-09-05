// functions/api/messages.read.js
export async function onRequestPost({ request, env }){
  const { getAuthed, json } = await import("../_lib/auth.js");
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error: "unauthorized" }, 401);

  const body = await request.json().catch(()=>null);
  const threadId = body?.thread_id;
  const lastSeenIso = body?.last_seen_at;
  if (!threadId || !lastSeenIso) return json({ error: "thread_id and last_seen_at required" }, 400);

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS message_reads (
      user_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (user_id, thread_id)
    );
  `).run();

  await env.DB.prepare(`
    INSERT INTO message_reads (user_id, thread_id, last_seen_at)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(user_id, thread_id) DO UPDATE SET last_seen_at=excluded.last_seen_at
  `).bind(auth.userId, threadId, lastSeenIso).run();

  return json({ ok: true });
}
