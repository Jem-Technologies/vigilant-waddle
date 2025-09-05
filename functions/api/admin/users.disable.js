import { getAuthed, json } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  const auth = await getAuthed(env, request);
  if (!auth?.ok) return json({ error:"unauthorized" }, 401);
  if (auth.role !== "Admin") return json({ error:"forbidden" }, 403);

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400);

  await env.DB.prepare(`UPDATE users SET disabled=1 WHERE id=?1`).bind(id).run();
  return json({ ok:true });
}
