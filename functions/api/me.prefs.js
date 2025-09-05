// functions/api/me.prefs.js
import { getAuthed, json } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error:"unauthorized" }, 401);
  const row = await env.DB.prepare(
    `SELECT nickname, use_nickname FROM users WHERE id=?1 LIMIT 1`
  ).bind(auth.userId).first();
  return json({
    nickname: row?.nickname ?? null,
    use_nickname: !!(row?.use_nickname ?? 0)
  });
}

export async function onRequestPost({ request, env }) {
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error:"unauthorized" }, 401);
  const body = await request.json().catch(() => null);
  if (!body) return json({ error:"invalid_json" }, 400);

  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : null;
  const useNick = body.use_nickname === true || body.use_nickname === 1;

  // Admins cannot set other users’ nicknames here—this endpoint is self-service only.
  await env.DB.prepare(
    `UPDATE users SET nickname=?1, use_nickname=?2 WHERE id=?3`
  ).bind(nickname || null, useNick ? 1 : 0, auth.userId).run();

  return json({ ok: true, nickname: nickname || null, use_nickname: useNick });
}
