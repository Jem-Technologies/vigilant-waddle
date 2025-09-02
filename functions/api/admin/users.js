// GET  /api/admin/users        -> list users in my org
// POST /api/admin/users        -> create user in my org (returns temp password)

export async function onRequestGet({ request, env }) {
  const me = await auth(env, request);
  if (!me.ok) return j(me.body, me.status);
  if (!isManager(me)) return j({ error:"Forbidden" }, 403);

  const rows = await env.DB.prepare(
    `SELECT u.id, u.name, u.username, u.email, m.role, u.created_at
       FROM user_orgs m
       JOIN users u ON u.id=m.user_id
      WHERE m.org_id=?1
      ORDER BY u.created_at DESC
      LIMIT 200`
  ).bind(me.org.id).all();

  return j({ users: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const me = await auth(env, request);
  if (!me.ok) return j(me.body, me.status);
  if (!isManager(me)) return j({ error:"Forbidden" }, 403);

  const body = await request.json().catch(()=>null);
  if (!body) return j({ error:"Invalid JSON" }, 400);

  const name = (body.name||"").trim();
  const username = (body.username||"").trim().toLowerCase();
  const email = (body.email||"").trim().toLowerCase();
  const role = (body.role||"Member").trim();
  if (!name || !username || !email) return j({ error:"name, username, email required" }, 400);

  // temp password (you can email this later)
  const temp = genTemp(12);

  // ensure user exists (or create)
  let user = await env.DB.prepare(`SELECT id FROM users WHERE lower(email)=?1 OR lower(username)=?2 LIMIT 1`)
    .bind(email, username).first();

  if (!user) {
    const { hashB64, saltB64 } = await hashPassword(temp);
    const uid = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, name, username, email, role, pwd_hash, pwd_salt, created_at)
       VALUES (?1, ?2, ?3, ?4, 'Member', ?5, ?6, unixepoch())`
    ).bind(uid, name, username, email, hashB64, saltB64).run();
    user = { id: uid };
  }

  // link to org (upsert)
  await env.DB.prepare(
    `INSERT OR REPLACE INTO user_orgs (user_id, org_id, role, created_at)
     VALUES (?1, ?2, ?3, unixepoch())`
  ).bind(user.id, me.org.id, role).run();

  return j({ ok:true, user_id: user.id, temp_password: temp });
}

// ------- helpers -------
const PBKDF2_ITERS = 100_000;

async function auth(env, request) {
  if (!env.DB) return { ok:false, status:500, body:{ error:"env.DB missing" } };
  const cookie = request.headers.get("cookie")||"";
  const sess = parseCookie(cookie).sess;
  if (!sess) return { ok:false, status:401, body:{ error:"Unauthorized" } };

  const now = Math.floor(Date.now()/1000);
  const row = await env.DB.prepare(
    `SELECT u.id as user_id, u.name, u.username, u.email, o.id as org_id, o.slug as org_slug,
            (SELECT role FROM user_orgs WHERE user_id=u.id AND org_id=o.id) as role
       FROM sessions s
       JOIN users u ON u.id=s.user_id
       JOIN organizations o ON o.id=s.org_id
      WHERE s.id=?1 AND s.expires_at>?2
      LIMIT 1`
  ).bind(sess, now).first();
  if (!row) return { ok:false, status:401, body:{ error:"Unauthorized" } };
  return { ok:true, org:{ id:row.org_id, slug:row.org_slug }, user:{ id:row.user_id, role:row.role } };
}
function isManager(me){ return me.user.role === "Admin" || me.user.role === "Manager"; }

function j(o,s=200){ return new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json; charset=utf-8"}}); }
function parseCookie(c){ const o={}; c.split(/;\s*/).forEach(kv=>{ const [k,...r]=kv.split("="); if(!k) return; o[k.trim()]=decodeURIComponent((r.join("=")||"").trim());}); return o; }

async function hashPassword(password){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name:"PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", hash:"SHA-256", salt, iterations: PBKDF2_ITERS }, key, 256);
  const hashB64 = b64(new Uint8Array(bits));
  const saltB64 = b64(salt);
  return { hashB64, saltB64 };
}
function b64(u8){ let s=""; for(let i=0;i<u8.length;i++) s+=String.fromCharCode(u8[i]); return btoa(s); }
function genTemp(n){ const a="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%"; let out=""; for(let i=0;i<n;i++) out+=a[Math.floor(Math.random()*a.length)]; return out; }
