export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) return j({ error:"env.DB missing" }, 500);

    const cookie = request.headers.get("cookie") || "";
    const sess = parseCookie(cookie).sess;
    if (!sess) return j({ error:"Unauthorized" }, 401);

    // load session + user
    const now = Math.floor(Date.now()/1000);
    const me = await env.DB.prepare(
      `SELECT u.id, u.role FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.id=?1 AND s.expires_at>?2 LIMIT 1`
    ).bind(sess, now).first();
    if (!me) return j({ error:"Unauthorized" }, 401);
    if (me.role !== "Admin" && me.role !== "Manager") return j({ error:"Forbidden" }, 403);

    const rows = await env.DB.prepare(
      `SELECT id, name, username, email, role, created_at FROM users ORDER BY created_at DESC LIMIT 100`
    ).all();

    return j({ users: rows.results || [] });
  } catch (e) {
    return j({ error: "Unhandled", detail: String(e?.message || e) }, 500);
  }
}
function parseCookie(c){const o={};c.split(/;\s*/).forEach(kv=>{const[t,...r]=kv.split("=");if(!t)return;o[t.trim()]=decodeURIComponent((r.join("=")||"").trim())});return o}
function j(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
