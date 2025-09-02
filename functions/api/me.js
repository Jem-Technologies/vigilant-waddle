export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) return j({ error: "env.DB missing" }, 500);

    const cookie = request.headers.get("cookie") || "";
    const sess = parseCookie(cookie).sess;
    if (!sess) return j({ auth: false });

    const now = Math.floor(Date.now() / 1000);
    const row = await env.DB.prepare(
      `SELECT u.id, u.name, u.username, u.email, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id=?1 AND s.expires_at > ?2
        LIMIT 1`
    ).bind(sess, now).first();

    if (!row) return j({ auth: false });
    return j({ auth: true, user: row });
  } catch (e) {
    return j({ error: "Unhandled", detail: String(e?.message || e) }, 500);
  }
}
function parseCookie(c) {
  const out = {};
  c.split(/;\s*/).forEach(kv => {
    const [k, ...rest] = kv.split("=");
    if (!k) return;
    out[k.trim()] = decodeURIComponent((rest.join("=") || "").trim());
  });
  return out;
}
function j(obj, status=200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type":"application/json; charset=utf-8" }});
}
