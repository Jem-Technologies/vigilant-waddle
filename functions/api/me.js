// functions/api/me.js
import { getAuthed, json } from "../_lib/auth.js";

export async function onRequestGet({ env, request }) {
  try {
    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ auth: false }, 401);

    // Try to fetch a minimal user profile from DB (optional but nicer for UI).
    // Keeps working even if DB is missing — you'll just get nulls for name/email/username.
    let u = null;
    try {
      if (env.DB) {
        u = await env.DB
          .prepare(`SELECT id, name, username, email FROM users WHERE id=?1 LIMIT 1`)
          .bind(auth.userId)
          .first();
      }
    } catch (e) {
      // Don't hard-fail ME endpoint on profile fetch errors
      console.warn("[me] profile fetch warning:", e);
    }

    const role = auth?.role ?? "Member";

    return json({
      auth: true,
      user: {
        id: u?.id ?? auth.userId ?? null,
        name: u?.name ?? null,
        username: u?.username ?? null,
        email: u?.email ?? null,
        role, // should be "Admin" or "Member" coming from getAuthed
      },
      org: auth?.orgId
        ? { id: auth.orgId, slug: auth.orgSlug ?? null, name: null }
        : null,
    }, 200);
  } catch (e) {
    console.error("[me][GET] unhandled:", e);
    return json({ auth: false, error: String(e) }, 500);
  }
}
