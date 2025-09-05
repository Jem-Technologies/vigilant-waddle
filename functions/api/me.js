// functions/api/me.js
import { getAuthed, json } from "../_lib/auth.js";

export async function onRequestGet(ctx) {
  try {
    const { env, request } = ctx;
    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ auth: false }, 401);

    const org_id =
      auth?.org_id ?? auth?.orgId ?? auth?.user?.org_id ?? auth?.session?.org_id ?? null;

    return json({
      auth: true,
      user: {
        id: auth?.user?.id ?? null,
        name: auth?.user?.name ?? auth?.user?.display_name ?? null,
        username: auth?.user?.username ?? null,
        email: auth?.user?.email ?? null,
        role: (auth?.admin || auth?.is_admin || auth?.user?.role === "admin") ? "Admin" : "Member",
      },
      org: org_id ? { id: org_id, slug: null, name: null } : null
    }, 200);
  } catch (e) {
    console.error("[me][GET] unhandled:", e);
    return json({ auth: false, error: String(e) }, 500);
  }
}
