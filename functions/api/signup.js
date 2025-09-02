import { getOrgSlugFromUrl } from "../_lib/tenant";

const PBKDF2_ITERS = 100_000;

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return j({ where:"preflight", error:"env.DB missing" }, 500);

    const body = await request.json().catch(()=>null);
    if (!body) return j({ where:"parse", error:"Invalid JSON" }, 400);

    const name = (body.name||"").trim();
    const username = (body.username||"").trim().toLowerCase();
    const email = (body.email||"").trim().toLowerCase();
    const password = String(body.password||"");

    if (!name || !username || !email || !password) return j({ where:"validate", error:"name, username, email, password required" }, 400);

    // ensure core tables
    await ensureCore(env.DB);

    // find or create org
    const orgSlugFromUrl = getOrgSlugFromUrl(request.url);
    const orgSlug = (body.org || orgSlugFromUrl || username).toLowerCase().replace(/[^a-z0-9-]/g,"-");
    let org = await env.DB.prepare(`SELECT id, slug, name FROM organizations WHERE slug=?1`).bind(orgSlug).first();
    if (!org) {
      const orgId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO organizations (id, slug, name, created_at) VALUES (?1, ?2, ?3, unixepoch())`
      ).bind(orgId, orgSlug, body.orgName || name+"'s Organization").run();
      org = { id: orgId, slug: orgSlug, name: body.orgName || `${name}'s Organization` };
    }

    // create user with hashed password
    const userId = crypto.randomUUID();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = new Uint8Array(await pbkdf2(password, salt, PBKDF2_ITERS));
    const saltB64 = b64(salt), hashB64 = b64(hash);

    try {
      await env.DB.prepare(
        `INSERT INTO users (id, name, username, email, role, pwd_hash, pwd_salt, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())`
      ).bind(userId, name, username, email, "Member", hashB64, saltB64).run();
    } catch (e) {
      const msg = String(e?.message||e);
      if (msg.includes("UNIQUE")) return j({ where:"insert-user", error:"username or email already exists" }, 409);
      return j({ where:"insert-user", error:"DB insert failed", detail: msg }, 500);
    }

    // First member in org becomes Admin
    const countOrg = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM user_orgs WHERE org_id=?1`
    ).bind(org.id).first();
    const isFirstInOrg = Number(countOrg?.c||0) === 0;
    const orgRole = isFirstInOrg ? "Admin" : "Member";

    await env.DB.prepare(
      `INSERT OR REPLACE INTO user_orgs (user_id, org_id, role, created_at)
       VALUES (?1, ?2, ?3, unixepoch())`
    ).bind(userId, org.id, orgRole).run();

    // create org-scoped session
    const sessionId = crypto.randomUUID();
    const exp = Math.floor(Date.now()/1000) + 60*60*24*30;
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, org_id, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4, unixepoch())`
    ).bind(sessionId, userId, org.id, exp).run();

    return new Response(JSON.stringify({
      ok:true,
      user:{ id:userId, name, username, email, role:orgRole },
      org:{ id:org.id, slug:org.slug, name:org.name }
    }), {
      status: 201,
      headers: {
        "content-type":"application/json; charset=utf-8",
        "set-cookie": makeCookie(sessionId, exp)
      }
    });

  } catch (err) {
    return j({ where:"top", error:"Unhandled", detail:String(err?.message||err) }, 500);
  }
}

function j(o,s=200){ return new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json; charset=utf-8"}}); }
async function ensureCore(DB){
  await DB.prepare(`CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`).run();
  await DB.prepare(`CREATE TABLE IF NOT EXISTS user_orgs (user_id TEXT NOT NULL, org_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'Member', created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (user_id,org_id))`).run();
  await DB.prepare(`ALTER TABLE sessions ADD COLUMN org_id TEXT`).run().catch(()=>{});
}
async function pbkdf2(pwd, saltBytes, iters){
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(pwd), {name:"PBKDF2"}, false, ["deriveBits"]);
  return crypto.subtle.deriveBits({name:"PBKDF2", hash:"SHA-256", salt:saltBytes, iterations:100_000}, key, 256);
}
function b64(u8){ let s=""; for(let i=0;i<u8.length;i++) s+=String.fromCharCode(u8[i]); return btoa(s); }
function makeCookie(id, exp){ return [`sess=${encodeURIComponent(id)}`,"Path=/","HttpOnly","Secure","SameSite=Lax",`Expires=${new Date(exp*1000).toUTCString()}`].join("; "); }
