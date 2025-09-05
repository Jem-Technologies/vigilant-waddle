// functions/api/departments.js
import { getAuthed, json } from "../_lib/auth.js";

/**
 * Minimal Supabase REST fetcher (no @supabase/supabase-js dependency).
 */
function supa(env) {
  const base = (env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    throw new Error("MISSING_SUPABASE_ENV: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
  }
  const headers = {
    "apikey": key,
    "Authorization": `Bearer ${key}`,
  };
  const rest = (path, init = {}) =>
    fetch(`${base}/rest/v1${path}`, {
      ...init,
      headers: {
        ...headers,
        ...(init.headers || {}),
      },
    });
  return { rest };
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

function isAdmin(auth) {
  return (
    auth?.admin === true ||
    auth?.is_admin === true ||
    auth?.user?.role === "admin" ||
    auth?.claims?.is_admin === true
  );
}

// CORS/preflight if you need it
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

export async function onRequestGet(ctx) {
  try {
    const { env, request } = ctx;
    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);
    if (!isAdmin(auth)) return json({ error: "forbidden" }, 403);

    const org_id = getOrgId(auth);
    if (!org_id) return json({ error: "missing org_id" }, 400);

    const { rest } = supa(env);
    const url = new URL(request.url);
    const q = url.searchParams.get("q"); // optional search
    const order = url.searchParams.get("order") || "name"; // optional order

    const filters = [`org_id=eq.${org_id}`];
    if (q) filters.push(`name=ilike.*${encodeURIComponent(q)}*`);

    const path = `/departments?${filters.join("&")}&select=id,name,org_id,created_at&order=${encodeURIComponent(
      order
    )}`;
    const res = await rest(path, { method: "GET" });

    const bodyText = await res.text();
    if (!res.ok) {
      return json({ error: bodyText || `HTTP ${res.status}`, code: "DB_SELECT_ERROR" }, res.status);
    }
    const data = bodyText ? JSON.parse(bodyText) : [];
    return json({ ok: true, departments: data }, 200);
  } catch (e) {
    console.error("[departments][GET] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}

export async function onRequestPost(ctx) {
  try {
    const { env, request } = ctx;
    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);
    if (!isAdmin(auth)) return json({ error: "forbidden" }, 403);

    const org_id = getOrgId(auth);
    if (!org_id) return json({ error: "missing org_id" }, 400);

    const payload = await request.json().catch(() => null);
    const name = payload?.name?.trim?.();
    if (!name) return json({ error: "name is required" }, 400);

    const { rest } = supa(env);
    const res = await rest(`/departments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify({ org_id, name }),
    });

    const bodyText = await res.text();
    if (!res.ok) {
      return json({ error: bodyText || `HTTP ${res.status}`, code: "DB_INSERT_ERROR" }, res.status);
    }
    const created = bodyText ? JSON.parse(bodyText) : [];
    return json({ ok: true, department: created[0] ?? null }, 201);
  } catch (e) {
    console.error("[departments][POST] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}

export async function onRequestPut(ctx) {
  try {
    const { env, request } = ctx;
    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);
    if (!isAdmin(auth)) return json({ error: "forbidden" }, 403);

    const org_id = getOrgId(auth);
    if (!org_id) return json({ error: "missing org_id" }, 400);

    const payload = await request.json().catch(() => null);
    const id = payload?.id;
    const name = payload?.name?.trim?.();
    if (!id) return json({ error: "id is required" }, 400);
    if (!name) return json({ error: "name is required" }, 400);

    const { rest } = supa(env);
    const path = `/departments?id=eq.${encodeURIComponent(id)}&org_id=eq.${encodeURIComponent(org_id)}`;
    const res = await rest(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify({ name }),
    });

    const bodyText = await res.text();
    if (!res.ok) {
      return json({ error: bodyText || `HTTP ${res.status}`, code: "DB_UPDATE_ERROR" }, res.status);
    }
    const updated = bodyText ? JSON.parse(bodyText) : [];
    return json({ ok: true, department: updated[0] ?? null }, 200);
  } catch (e) {
    console.error("[departments][PUT] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}

export async function onRequestDelete(ctx) {
  try {
    const { env, request } = ctx;
    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);
    if (!isAdmin(auth)) return json({ error: "forbidden" }, 403);

    const org_id = getOrgId(auth);
    if (!org_id) return json({ error: "missing org_id" }, 400);

    const url = new URL(request.url);
    const id = url.searchParams.get("id") || (await request.clone().json().catch(() => null))?.id;
    if (!id) return json({ error: "id is required" }, 400);

    const { rest } = supa(env);
    const path = `/departments?id=eq.${encodeURIComponent(id)}&org_id=eq.${encodeURIComponent(org_id)}`;
    const res = await rest(path, {
      method: "DELETE",
      headers: { "Prefer": "count=exact" },
    });

    // PostgREST returns 204 with no body on DELETE by default
    if (!res.ok && res.status !== 204) {
      const txt = await res.text();
      return json({ error: txt || `HTTP ${res.status}`, code: "DB_DELETE_ERROR" }, res.status);
    }
    return json({ ok: true, deleted: 1 }, 200);
  } catch (e) {
    console.error("[departments][DELETE] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}
