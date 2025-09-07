// functions/api/groups.js
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
  if (!env?.DB) {
    throw new Error(
      "D1 binding env.DB is missing. Add it in wrangler.toml and your Pages/Worker bindings."
    );
  }
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

// ---- GET: list groups (returns RAW ARRAY for arr.map) ----
export async function onRequestGet(ctx) {
  try {
    const { env, request } = ctx;
    ensureDB(env);

    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);
    // NOTE: no admin required for reads
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
             FROM groups
            WHERE org_id = ? AND name LIKE ? ESCAPE '\\'
            ORDER BY ${order}`
        )
        .bind(org_id, likeQuery(q));
    } else {
      stmt = env.DB
        .prepare(
          `SELECT id, name, org_id, created_at
             FROM groups
            WHERE org_id = ?
            ORDER BY ${order}`
        )
        .bind(org_id);
    }

    const { results } = await stmt.all();
    return json(results ?? [], 200); // raw array
  } catch (e) {
    console.error("[groups][GET] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}

// ---- POST: create group (admin) + best-effort chat thread creation ----
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
    const department_id = body?.department_id || null;
    if (!name) return json({ error: "name is required" }, 400);

    const id = crypto.randomUUID();
    await env.DB
      .prepare(
        `INSERT INTO groups (id, org_id, name, created_at, updated_at)
         VALUES (?1, ?2, ?3, unixepoch(), unixepoch())`
      )
      .bind(id, org_id, name)
      .run();

    // Add creator as a member so they can see its threads
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO group_members (group_id, user_id, created_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)`
      ).bind(id, auth.userId || auth?.user?.id || null).run();
    } catch (e) {
      console.warn("[groups][POST] membership insert skipped:", e?.message || e);
    }


    // --- Best-effort: create a default chat thread for this group ---
    // If your DB doesn't have a 'threads' table, this silently no-ops.
    let chat_thread_id = null;
    try {
      chat_thread_id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO threads (id, org_id, title, department_id, group_id, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, unixepoch())`
      ).bind(
        chat_thread_id,
        org_id,
        `Dept: ${name}`,
        id,
        (auth.userId || auth?.user?.id || null)
      ).run();

      // Welcome message
      await env.DB.prepare(
       `INSERT INTO messages (id, thread_id, sender_id, kind, body, media_url, created_at)
         VALUES (?1, ?2, ?3, 'text', json_object('text', ?4), NULL, datetime('now'))`
      ).bind(
        crypto.randomUUID(),
        chat_thread_id,
        (auth.userId || null),
        `Hello, welcome to ${name}!`
      ).run();

    } catch (err) {
      console.warn("[departments][POST] thread create skipped:", err?.message || err);
      chat_thread_id = null;
    }
  }

// ---- PUT: update group (admin) + best-effort thread title sync ----
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
    const department_id = body?.department_id || null;
    if (!id) return json({ error: "id is required" }, 400);
    if (!name) return json({ error: "name is required" }, 400);

    const { meta } = await env.DB
      .prepare(
        `UPDATE groups
            SET name = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND org_id = ?`
      )
      .bind(name, id, org_id)
      .run();

    if (!meta || meta.changes === 0) return json({ error: "not found" }, 404);

    // --- Best-effort: keep related group thread title in sync ---
    try {
      await env.DB
        .prepare(
          `UPDATE threads
              SET title = ?, updated_at = CURRENT_TIMESTAMP
            WHERE group_id = ? AND org_id = ?`
        )
        .bind(`Group: ${name}`, id, org_id)
        .run();
    } catch (err) {
      console.warn("[groups][PUT] thread title sync skipped:", err?.message || err);
    }

    const { results } = await env.DB
      .prepare(`SELECT id, name, org_id, created_at FROM groups WHERE id = ?`)
      .bind(id)
      .all();

    return json({ ok: true, group: results?.[0] ?? null }, 200);
  } catch (e) {
    console.error("[groups][PUT] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}

// ---- DELETE: remove group (admin) ----
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
      .prepare(`DELETE FROM groups WHERE id = ? AND org_id = ?`)
      .bind(id, org_id)
      .run();

    // NOTE: We intentionally do NOT delete related threads here to avoid breaking existing chats.
    // If you want to archive them, handle it in a separate maintenance task.

    return json({ ok: true, deleted: meta?.changes ?? 0 }, 200);
  } catch (e) {
    console.error("[groups][DELETE] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}
}
