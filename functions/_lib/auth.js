// functions/_lib/auth.js
// Session-based auth helper (compatible with your existing /api/me)
// Returns { ok: true, userId, orgId, role, orgSlug } or { ok:false }
export async function getAuthed(env, request) {
  const cookie = request.headers.get("cookie") || "";
  const sess = parseCookie(cookie).sess;
  if (!sess) return { ok:false, reason:"no_session" };
  const now = Math.floor(Date.now()/1000);
  const row = await env.DB.prepare(
    `SELECT u.id AS user_id, o.id AS org_id, o.slug AS org_slug, m.role AS role
       FROM sessions s
       JOIN users u ON u.id=s.user_id
       JOIN organizations o ON o.id=s.org_id
       JOIN user_orgs m ON m.user_id=u.id AND m.org_id=o.id
      WHERE s.id=?1 AND s.expires_at>?2
      LIMIT 1`
  ).bind(sess, now).first();
  if (!row) return { ok:false, reason:"expired_or_bad_session" };
  return { ok:true, userId: row.user_id, orgId: row.org_id, role: row.role, orgSlug: row.org_slug };
}
function parseCookie(c){ const o={}; c.split(/;\s*/).forEach(kv=>{ const r=kv.split("="); if(!r[0]) return; o[r[0].trim()]=decodeURIComponent((r.slice(1).join("=")||"").trim());}); return o; }
export function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type":"application/json; charset=utf-8" } });
}
export function requireAdmin(auth){ if(!auth.ok) return "unauthorized"; if(auth.role!=="Admin") return "forbidden"; return null; }
