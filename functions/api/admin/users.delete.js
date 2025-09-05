import { getAuthed, json } from "../../_lib/auth.js";

export async function onRequestDelete({ request, env }) {
  const auth = await getAuthed(env, request);
  if (!auth?.ok) return json({ error:"unauthorized" }, 401);
  if (auth.role !== "Admin") return json({ error:"forbidden" }, 403);

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400);

  // best-effort cascade (adjust to your needs)
  await env.DB.prepare(`DELETE FROM user_orgs WHERE user_id=?1`).bind(id).run().catch(()=>{});
  await env.DB.prepare(`DELETE FROM sessions WHERE user_id=?1`).bind(id).run().catch(()=>{});
  await env.DB.prepare(`DELETE FROM users WHERE id=?1`).bind(id).run();
  return json({ ok:true });
}
