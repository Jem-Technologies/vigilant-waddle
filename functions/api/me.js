// functions/api/me.js
export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) return j({ error:"env.DB missing" }, 500);
    const cookie = request.headers.get("cookie")||"";
    const sess = parseCookie(cookie).sess;
    if (!sess) return j({ auth:false });

    const now = Math.floor(Date.now()/1000);
    const row = await env.DB.prepare(
      `SELECT u.id, u.name, u.username, u.email, m.role, o.id AS org_id, o.slug AS org_slug, o.name AS org_name
         FROM sessions s
         JOIN users u ON u.id=s.user_id
         JOIN organizations o ON o.id=s.org_id
         JOIN user_orgs m ON m.user_id=u.id AND m.org_id=o.id
        WHERE s.id=?1 AND s.expires_at>?2
        LIMIT 1`
    ).bind(sess, now).first();

    if (!row) return j({ auth:false });
    return j({ auth:true, user:{ id:row.id, name:row.name, username:row.username, email:row.email, role:row.role }, org:{ id:row.org_id, slug:row.org_slug, name:row.org_name } });
  } catch (e) {
    return j({ error:"Unhandled", detail:String(e?.message||e) }, 500);
  }
}
function j(o,s=200){ return new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json; charset=utf-8"}}); }
function parseCookie(c){ const o={}; c.split(/;\s*/).forEach(kv=>{ const [k,...r]=kv.split("="); if(!k) return; o[k.trim()]=decodeURIComponent((r.join("=")||"").trim());}); return o; }
