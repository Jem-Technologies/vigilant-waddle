// functions/api/permissions.js
import { getAuthed, json } from "../_lib/auth.js";

export async function onRequestGet({ env, request }) {
  const auth = await getAuthed(env, request);
  if (!auth?.ok) return json({ error: "unauthorized" }, 401);

  const { results } = await env.DB.prepare(
    `SELECT id, key, COALESCE(description, '') AS description
     FROM permissions ORDER BY key`
  ).all();

  return json({ permissions: results || [] }, 200);
}
