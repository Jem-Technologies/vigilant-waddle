// functions/api/login.js
export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return j({ error: "Database not bound (env.DB missing). Add D1 binding 'DB' in Pages → Settings → Functions." }, 500);
    }

    // Parse JSON body (must be application/json)
    let body;
    try { body = await request.json(); }
    catch { return j({ error: "Invalid JSON body" }, 400); }

    const id = String(body.id || "").trim().toLowerCase();  // email OR username
    const password = String(body.password || "");

    if (!id || !password) return j({ error: "id (email or username) and password are required" }, 400);

    // Look up user by email or username (case-insensitive)
    const user = await env.DB
      .prepare(`
        SELECT id, name, username, email, role, pwd_hash, pwd_salt
        FROM users
        WHERE lower(email)=?1 OR lower(username)=?1
        LIMIT 1
      `)
      .bind(id)
      .first();

    // Uniform timing: don't reveal which part failed
    if (!user) return j({ error: "Invalid credentials" }, 401);

    // Derive hash with same parameters used during signup
    const ok = await verifyPassword(password, user.pwd_salt, user.pwd_hash);
    if (!ok) return j({ error: "Invalid credentials" }, 401);

    // Create fresh session (30d)
    const sessionId = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;

    try {
      await env.DB
        .prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, unixepoch())`)
        .bind(sessionId, user.id, expiresAt)
        .run();
    } catch (e) {
      return j({ error: "Session create failed", detail: String(e?.message || e) }, 500);
    }

    const cookie = makeSessionCookie(sessionId, expiresAt);

    return new Response(JSON.stringify({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role
      }
    }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": cookie
      }
    });

  } catch (err) {
    return j({ error: "Unhandled error", detail: String(err?.message || err) }, 500);
  }
}

// ------ helpers ------
function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function verifyPassword(password, saltBlob, hashBlob) {
  // saltBlob and hashBlob come out of D1 as ArrayBuffer/Uint8Array depending on driver
  const salt = toUint8Array(saltBlob);
  const expected = toUint8Array(hashBlob);

  const derivedBits = await pbkdf2(password, salt, 150_000); // must match signup
  const actual = new Uint8Array(derivedBits); // 32 bytes

  // constant-time compare
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

async function pbkdf2(password, saltBytes, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations }, key, 256);
}

function toUint8Array(blobOrArrayBuffer) {
  if (blobOrArrayBuffer instanceof Uint8Array) return blobOrArrayBuffer;
  if (blobOrArrayBuffer?.buffer instanceof ArrayBuffer) return new Uint8Array(blobOrArrayBuffer.buffer);
  if (blobOrArrayBuffer instanceof ArrayBuffer) return new Uint8Array(blobOrArrayBuffer);
  // Some environments return plain objects; fall back to conversion
  return new Uint8Array(blobOrArrayBuffer);
}

function makeSessionCookie(sessionId, expUnix) {
  const expires = new Date(expUnix * 1000).toUTCString();
  return [
    `sess=${encodeURIComponent(sessionId)}`,
    `Path=/`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
    `Expires=${expires}`
  ].join("; ");
}
