// functions/api/groups.js
import { getAuthed, json } from "../_lib/auth.js";

// ---- helpers ----
function isPrivileged(auth) {
  const r = String(auth?.role || '').toLowerCase();
  return r === 'admin' || r === 'owner';
}
function getOrgId(auth) {
  return auth?.org_id ?? auth?.orgId ?? auth?.user?.org_id ?? auth?.session?.org_id ?? null;
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

// ---- GET: list groups (raw array for arr.map) ----
export async function onRequestGet(ctx) {
  try {
    const { env, request } = ctx;
    ensureDB(env);

    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);
    const org_id = getOrgId(auth);
    if (!org_id) return json({ error: "missing org_id" }, 400);

    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim();
    const deptFilter = url.searchParams.get("department_id") || null;
    const orderParam = (url.searchParams.get("order") || "name").toLowerCase();
    const order = orderParam === "created_at" ? "created_at" : "name"; // whitelist

    let sql = `
      SELECT
        g.id, g.name, g.org_id, g.department_id, g.created_at,
        d.name AS department_name,
        IFNULL((SELECT COUNT(*) FROM threads t WHERE t.org_id = g.org_id AND t.group_id = g.id), 0) AS thread_count,
        IFNULL((SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id), 0) AS member_count
      FROM groups g
      LEFT JOIN departments d ON d.id = g.department_id
      WHERE g.org_id = ?
    `;
    const binds = [org_id];
    if (deptFilter) { sql += " AND g.department_id = ?"; binds.push(deptFilter); }
    if (q) {
      sql += " AND g.name LIKE ? ESCAPE '\\'";
      binds.push((q || '').replace(/[%_]/g, s => "\\" + s) + '%');
    }
    sql += ` ORDER BY ${order}`;

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json(results ?? [], 200);
  } catch (e) {
    console.error("[groups][GET] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}

// ---- POST: create group (admin/owner) + default chat thread ----
export async function onRequestPost(ctx) {
  try {
    const { env, request } = ctx;
    ensureDB(env);

    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);
    if (!isPrivileged(auth)) return json({ error: "forbidden" }, 403);

    const org_id = getOrgId(auth);
    if (!org_id) return json({ error: "missing org_id" }, 400);

    const body = await request.json().catch(() => null);
    const name = body?.name?.trim?.();
    const department_id = body?.department_id || null;
    if (!name) return json({ error: "name is required" }, 400);

    const id = crypto.randomUUID();

    // Persist department on group
    await env.DB.prepare(
      `INSERT INTO groups (id, org_id, department_id, name, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, unixepoch(), unixepoch())`
    ).bind(id, org_id, department_id, name).run();

    // Add creator as member
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO group_members (group_id, user_id, created_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)`
      ).bind(id, auth.userId || auth?.user?.id || null).run();
    } catch (e) {
      console.warn("[groups][POST] membership insert skipped:", e?.message || e);
    }

    // Create default chat thread with the same department context
    let chat_thread_id = null;
    try {
      chat_thread_id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO threads (id, org_id, title, department_id, group_id, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, unixepoch())`
      ).bind(
        chat_thread_id,
        org_id,
        `Group: ${name}`,
        (department_id || null),
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
      console.warn("[groups][POST] thread create skipped:", err?.message || err);
      chat_thread_id = null;
    }

    return json({ ok: true, group: { id, name, org_id, department_id, chat_thread_id } }, 200);
  } catch (e) {
    console.error("[groups][POST] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}

// ---- PUT: update group (admin/owner) + optional thread title sync ----
export async function onRequestPut(ctx) {
  try {
    const { env, request } = ctx;
    ensureDB(env);

    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);
    if (!isPrivileged(auth)) return json({ error: "forbidden" }, 403);

    const org_id = getOrgId(auth);
    if (!org_id) return json({ error: "missing org_id" }, 400);

    const body = await request.json().catch(() => null);
    const id = body?.id;
    const name = body?.name?.trim?.();
    const department_id = body?.department_id || null;
    if (!id) return json({ error: "id is required" }, 400);
    if (!name) return json({ error: "name is required" }, 400);

    await env.DB.prepare(
      `UPDATE groups
          SET name = ?2,
              department_id = ?3,
              updated_at = unixepoch()
        WHERE id = ?1 AND org_id = ?4`
    ).bind(id, name, department_id, org_id).run();

    // Best-effort: sync default thread title (doesn't assume a specific "default" marker)
    try {
      await env.DB.prepare(
        `UPDATE threads
            SET title = ?1
          WHERE group_id = ?2
            AND org_id = ?3
            AND title LIKE 'Group:%'`
      ).bind(`Group: ${name}`, id, org_id).run();
    } catch (err) {
      console.warn("[groups][PUT] thread title sync skipped:", err?.message || err);
    }

    const { results } = await env.DB
      .prepare(`SELECT id, name, org_id, department_id, created_at FROM groups WHERE id = ?`)
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
    if (!isPrivileged(auth)) return json({ error: "forbidden" }, 403);

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