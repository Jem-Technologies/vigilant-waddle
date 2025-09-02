export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return j({ error: "env.DB missing" }, 500);
    const cookie = request.headers.get("cookie") || "";
    const sess = parseCookie(cookie).sess;
    if (sess) {
      await env.DB.prepare(`DELETE FROM sessions WHERE id=?1`).bind(sess).run().catch(()=>{});
    }
    // expire cookie
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type":"application/json; charset=utf-8",
        "set-cookie":"sess=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
      }
    });
  } catch (e) {
    return j({ error: "Unhandled", detail: String(e?.message || e) }, 500);
  }
}
function parseCookie(c){const o={};c.split(/;\s*/).forEach(kv=>{const[t,...r]=kv.split("=");if(!t)return;o[t.trim()]=decodeURIComponent((r.join("=")||"").trim())});return o}
function j(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
