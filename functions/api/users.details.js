// functions/api/users.details.js
import { getAuthed, json } from "../_lib/auth.js";

// --- helpers ---
function ensureDB(env) {
  if (!env?.DB) throw new Error("D1 binding env.DB is missing. Add it in wrangler.toml and your Pages/Worker bindings.");
}
function isAdmin(auth) {
  return (
    auth?.admin === true ||
    auth?.is_admin === true ||
    auth?.user?.role === "admin" ||
    auth?.claims?.is_admin === true
  );
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
function dedupeById(rows) {
  const m = new Map();
  for (const r of rows || []) if (!m.has(r.id)) m.set(r.id, r);
  return [...m.values()];
}

// --- CORS / preflight (optional) ---
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function onRequestGet(ctx) {
  try {
    const { env, request } = ctx;
    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);

    const user = {
      id: auth?.user?.id ?? null,
      email: auth?.user?.email ?? null,
      display_name: auth?.user?.name ?? auth?.user?.display_name ?? null,
    };
    const org_id = getOrgId(auth);
    const admin = isAdmin(auth);

    const out = {
      ok: true,
      user,
      org_id,
      admin,
      groups: [],
      roles_direct: [],
      roles_via_groups: [],
      roles_effective: [],
      permissions: [],
    };

    // Enrich from D1 (if bound and we have user/org)
    if (env?.DB && user.id && org_id) {
      ensureDB(env);

      // Groups
      try {
        const { results: groups } = await env.DB.prepare(
          `SELECT g.id, g.name
             FROM user_groups ug
             JOIN groups g ON g.id = ug.group_id AND g.org_id = ug.org_id
            WHERE ug.user_id = ? AND ug.org_id = ?
            ORDER BY g.name`
        ).bind(user.id, org_id).all();
        out.groups = groups ?? [];
      } catch (e) {
        console.warn("[users.details] groups query failed:", e);
      }

      // Direct roles
      try {
        const { results: rolesDirect } = await env.DB.prepare(
          `SELECT r.id, r.name, r.is_admin
             FROM user_roles ur
             JOIN roles r ON r.id = ur.role_id AND r.org_id = ur.org_id
            WHERE ur.user_id = ? AND ur.org_id = ?
            ORDER BY r.name`
        ).bind(user.id, org_id).all();
        out.roles_direct = (rolesDirect ?? []).map(r => ({
          id: r.id,
          name: r.name,
          is_admin: !!r.is_admin, // D1 booleans are integers (0/1)
          via: "direct",
        }));
      } catch (e) {
        console.warn("[users.details] roles_direct query failed:", e);
      }

      // Roles via groups (inherited)
      try {
        const { results: rolesVia } = await env.DB.prepare(
          `SELECT r.id, r.name, r.is_admin, g.id AS via_group_id, g.name AS via_group_name
             FROM user_groups ug
             JOIN group_roles gr ON gr.group_id = ug.group_id AND gr.org_id = ug.org_id
             JOIN roles r ON r.id = gr.role_id AND r.org_id = gr.org_id
             JOIN groups g ON g.id = ug.group_id AND g.org_id = ug.org_id
            WHERE ug.user_id = ? AND ug.org_id = ?
            ORDER BY r.name`
        ).bind(user.id, org_id).all();
        out.roles_via_groups = (rolesVia ?? []).map(r => ({
          id: r.id,
          name: r.name,
          is_admin: !!r.is_admin,
          via: "group",
          via_group_id: r.via_group_id,
          via_group_name: r.via_group_name,
        }));
      } catch (e) {
        console.warn("[users.details] roles_via_groups query failed:", e);
      }

      // Effective roles (dedup by role id across direct + inherited)
      out.roles_effective = dedupeById([...out.roles_direct, ...out.roles_via_groups]);

      // Permissions: prefer the view; fallback to UNION-based computation
      try {
        const { results } = await env.DB.prepare(
          `SELECT code FROM v_effective_user_permissions
            WHERE user_id = ? AND org_id = ?`
        ).bind(user.id, org_id).all();
        out.permissions = Array.isArray(results) ? [...new Set(results.map(r => r.code))] : [];
      } catch (viewErr) {
        // Fallback without the view
        try {
          const { results: perms } = await env.DB.prepare(
            `SELECT DISTINCT p.code
               FROM permissions p
               JOIN role_permissions rp ON rp.permission_id = p.id
              WHERE rp.role_id IN (
                     SELECT ur.role_id
                       FROM user_roles ur
                      WHERE ur.user_id = ? AND ur.org_id = ?
                     UNION
                     SELECT gr.role_id
                       FROM user_groups ug
                       JOIN group_roles gr
                         ON gr.group_id = ug.group_id AND gr.org_id = ug.org_id
                      WHERE ug.user_id = ? AND ug.org_id = ?
                   )
              ORDER BY p.code`
          ).bind(user.id, org_id, user.id, org_id).all();
          out.permissions = (perms ?? []).map(r => r.code);
        } catch (permErr) {
          console.warn("[users.details] permissions fallback failed:", permErr);
        }
      }
    }

    return json(out, 200);
  } catch (e) {
    console.error("[users.details][GET] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}
