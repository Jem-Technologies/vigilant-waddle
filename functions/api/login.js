// functions/api/login.js
import { getOrgSlugFromUrl } from "../_lib/tenant.js";
const PBKDF2_ITERS = 100_000;

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return j({ where:"preflight", error:"env.DB missing" }, 500);

    const body = await request.json().catch(()=>null);
    if (!body) return j({ where:"parse", error:"Invalid JSON" }, 400);

    const id = String(body.id||"").trim().toLowerCase();          // email or username
    const password = String(body.password||"");
    const orgSlug = (body.org || getOrgSlugFromUrl(request.url) || "").toLowerCase();

    if (!id || !password) return j({ where:"validate", error:"id and password required" }, 400);
    if (!orgSlug) return j({ where:"validate", error:"org is required" }, 400);

    const org = await env.DB.prepare(`SELECT id, slug, name FROM organizations WHERE slug=?1`).bind(orgSlug).first();
    if (!org) return j({ where:"org", error:"Organization not found" }, 404);

    const user = await env.DB.prepare(`
      SELECT id, name, username, email, role, pwd_hash, pwd_salt
      FROM users
      WHERE lower(email)=?1 OR lower(username)=?1
      LIMIT 1
    `).bind(id).first();
    if (!user) return j({ where:"lookup", error:"Invalid credentials" }, 401);

    // confirm membership
    const mem = await env.DB.prepare(
      `SELECT role FROM user_orgs WHERE user_id=?1 AND org_id=?2 LIMIT 1`
    ).bind(user.id, org.id).first();
    if (!mem) return j({ where:"membership", error:"No access to this organization" }, 403);

    // verify password
    const salt = b64dec(user.pwd_salt);
    const expected = b64dec(user.pwd_hash);
    const actual = new Uint8Array(await pbkdf2(password, salt, PBKDF2_ITERS));
    if (!tse(actual, expected)) return j({ where:"verify", error:"Invalid credentials" }, 401);

    const sess = crypto.randomUUID();
    const exp = Math.floor(Date.now()/1000) + 60*60*24*30;
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, org_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, unixepoch())`
    ).bind(sess, user.id, org.id, exp).run();

    return new Response(JSON.stringify({
      ok:true,
      user:{ id:user.id, name:user.name, username:user.username, email:user.email, role:mem.role },
      org
    }), { status:200, headers:{ "content-type":"application/json; charset=utf-8", "set-cookie": makeCookie(sess, exp) }});

  } catch (err) {
    return j({ where:"top", error:"Unhandled", detail:String(err?.message||err) }, 500);
  }
}

function j(o,s=200){ return new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json; charset=utf-8"}}); }
async function pbkdf2(p,s,i){ const enc=new TextEncoder(); const k=await crypto.subtle.importKey("raw",enc.encode(p),{name:"PBKDF2"},false,["deriveBits"]); return crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:s,iterations:i},k,256); }
function b64dec(str){ const bin=atob(str); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; }
function tse(a,b){ if(a.length!==b.length) return false; let d=0; for(let i=0;i<a.length;i++) d|=a[i]^b[i]; return d===0; }
function makeCookie(id, exp){ return [`sess=${encodeURIComponent(id)}`,"Path=/","HttpOnly","Secure","SameSite=Lax",`Expires=${new Date(exp*1000).toUTCString()}`].join("; "); }
