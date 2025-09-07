// functions/api/departments.js
import { getAuthed, json } from "../_lib/auth.js";

// ---- helpers ----
function isAdmin(auth) {
  return auth?.role === "Admin";
}

function getOrgId(auth) {
  return (
    auth?.org_id ??
    auth?.orgId ??
    auth?.user?.org_id ??
    auth?.session?.org_id ??
    null
  );
}

// escape % and _ for LIKE; we use ESCAPE '\'
function likeQuery(q) {
  return `%${q.replace(/[%_]/g, (s) => "\\" + s)}%`;
}

function ensureDB(env) {
  if (!env?.DB)
    throw new Error(
      "D1 binding env.DB is missing. Add it in wrangler.toml and your Pages/Worker bindings."
    );
}

// ---- CORS / preflight ----
export async function onRequestOptions(ctx) {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

// ---- GET: list departments (returns RAW ARRAY for arr.map) ----
export async function onRequestGet(ctx) {
  try {
    const { env, request } = ctx;
    ensureDB(env);

    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);
    // NOTE: no admin requirement for reading
    const org_id = getOrgId(auth);
    if (!org_id) return json({ error: "missing org_id" }, 400);

    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim();
    const orderParam = (url.searchParams.get("order") || "name").toLowerCase();
    const order = orderParam === "created_at" ? "created_at" : "name"; // whitelist

    let stmt;
    if (q) {
      stmt = env.DB
        .prepare(
          `SELECT id, name, org_id, created_at
             FROM departments
            WHERE org_id = ? AND name LIKE ? ESCAPE '\\'
            ORDER BY ${order}`
        )
        .bind(org_id, likeQuery(q));
    } else {
      stmt = env.DB
        .prepare(
          `SELECT id, name, org_id, created_at
             FROM departments
            WHERE org_id = ?
            ORDER BY ${order}`
        )
        .bind(org_id);
    }

    const { results } = await stmt.all();
    // Return a raw array so existing arr.map(...) doesn’t crash
    return json(results ?? [], 200);
  } catch (e) {
    console.error("[departments][GET] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}

// ---- POST: create department (admin) + best-effort chat thread creation ----
export async function onRequestPost(ctx) {
  try {
    const { env, request } = ctx;
    ensureDB(env);

    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);
    if (!isAdmin(auth)) return json({ error: "forbidden" }, 403);

    const org_id = getOrgId(auth);
    if (!org_id) return json({ error: "missing org_id" }, 400);

    const body = await request.json().catch(() => null);
    const name = body?.name?.trim?.();
    if (!name) return json({ error: "name is required" }, 400);

    const id = crypto.randomUUID();
    await env.DB
      .prepare(
        `INSERT INTO departments (id, org_id, name, created_at, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .bind(id, org_id, name)
      .run();
    // Add creator as a member so they can see department threads
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO department_members (department_id, user_id, created_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)`
      ).bind(id, auth.userId || auth?.user?.id || null).run();
    } catch (e) {
      console.warn("[departments][POST] membership insert skipped:", e?.message || e);
    }


    // --- Best-effort: create a default department chat thread ---
    // If 'threads' doesn't exist or constraint differs, we ignore the error.
    let chat_thread_id = null;
      chat_thread_id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO threads (id, org_id, title, department_id, group_id, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, unixepoch())`
      ).bind(chat_thread_id, org_id, `Dept: ${name}`, id, (auth.userId || auth?.user?.id || null)).run();
      /* Welcome message */
      await env.DB.prepare(
        `INSERT INTO messages (id, thread_id, sender_id, kind, body, media_url, created_at)
         VALUES (?1, ?2, ?3, 'text', json_object('text', ?4), NULL, datetime('now'))`
      ).bind(crypto.randomUUID(), chat_thread_id, (auth.userId || null), `Hello, welcome to ${name}!`).run();
     } catch (err) {
       console.warn("[departments][POST] thread create skipped:", err?.message || err);
       chat_thread_id = null;
     }

    const { results } = await env.DB
      .prepare(
        `SELECT id, name, org_id, created_at
           FROM departments
          WHERE id = ?`
      )
      .bind(id)
      .all();

    return json(
      { ok: true, department: results?.[0] ?? null, chat_thread_id },
      201
    );
  } catch (e) {
    console.error("[departments][POST] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}

// ---- PUT: update department (admin) + best-effort thread title sync ----
export async function onRequestPut(ctx) {
  try {
    const { env, request } = ctx;
    ensureDB(env);

    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);
    if (!isAdmin(auth)) return json({ error: "forbidden" }, 403);

    const org_id = getOrgId(auth);
    if (!org_id) return json({ error: "missing org_id" }, 400);

    const body = await request.json().catch(() => null);
    const id = body?.id;
    const name = body?.name?.trim?.();
    if (!id) return json({ error: "id is required" }, 400);
    if (!name) return json({ error: "name is required" }, 400);

    const { meta } = await env.DB
      .prepare(
        `UPDATE departments
            SET name = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND org_id = ?`
      )
      .bind(name, id, org_id)
      .run();

    if (!meta || meta.changes === 0) return json({ error: "not found" }, 404);

    // --- Best-effort: keep related department thread title in sync ---
    try {
      await env.DB
        .prepare(
          `UPDATE threads
              SET title = ?, updated_at = CURRENT_TIMESTAMP
            WHERE department_id = ? AND org_id = ?`
        )
        .bind(`Dept: ${name}`, id, org_id)
        .run();
    } catch (err) {
      console.warn("[departments][PUT] thread title sync skipped:", err?.message || err);
    }

    const { results } = await env.DB
      .prepare(
        `SELECT id, name, org_id, created_at
           FROM departments
          WHERE id = ?`
      )
      .bind(id)
      .all();

    return json({ ok: true, department: results?.[0] ?? null }, 200);
  } catch (e) {
    console.error("[departments][PUT] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}

// ---- DELETE: remove department (admin) ----
export async function onRequestDelete(ctx) {
  try {
    const { env, request } = ctx;
    ensureDB(env);

    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);
    if (!isAdmin(auth)) return json({ error: "forbidden" }, 403);

    const org_id = getOrgId(auth);
    if (!org_id) return json({ error: "missing org_id" }, 400);

    const url = new URL(request.url);
    const id =
      url.searchParams.get("id") ||
      (await request.clone().json().catch(() => null))?.id;
    if (!id) return json({ error: "id is required" }, 400);

    const { meta } = await env.DB
      .prepare(`DELETE FROM departments WHERE id = ? AND org_id = ?`)
      .bind(id, org_id)
      .run();

    // We intentionally don't delete related threads to avoid breaking chat history.
    return json({ ok: true, deleted: meta?.changes ?? 0 }, 200);
  } catch (e) {
    console.error("[departments][DELETE] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}
