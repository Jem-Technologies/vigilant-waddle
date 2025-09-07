// functions/api/users.js
import { getAuthed, json } from "../../_lib/auth.js";

/* ----------------- helpers ----------------- */
function ensureDB(env) {
  if (!env?.DB) throw new Error("D1 binding env.DB is missing.");
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
    auth?.org_id ?? auth?.orgId ?? auth?.user?.org_id ?? auth?.session?.org_id ?? null
  );
}

async function ensureOrgBasics(env, org_id) {
  // Ensure Admin role
  let { results: r1 } = await env.DB
    .prepare(`SELECT id FROM roles WHERE org_id = ? AND name = 'Admin'`)
    .bind(org_id).all();
  let adminRoleId = r1?.[0]?.id;
  if (!adminRoleId) {
    adminRoleId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO roles (id, org_id, name, description, is_admin, created_at, updated_at)
       VALUES (?, ?, 'Admin', 'Full access', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(adminRoleId, org_id).run();
  }

  // Ensure Member role
  let { results: r2 } = await env.DB
    .prepare(`SELECT id FROM roles WHERE org_id = ? AND name = 'Member'`)
    .bind(org_id).all();
  let memberRoleId = r2?.[0]?.id;
  if (!memberRoleId) {
    memberRoleId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO roles (id, org_id, name, description, is_admin, created_at, updated_at)
       VALUES (?, ?, 'Member', 'Default member', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(memberRoleId, org_id).run();
  }

  // Grant ALL permissions to Admin (if any exist)
  const { results: perms } = await env.DB.prepare(`SELECT id FROM permissions`).all();
  if (Array.isArray(perms) && perms.length) {
    const stmts = perms.map(p =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO role_permissions (role_id, permission_id, created_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)`
      ).bind(adminRoleId, p.id)
    );
    await env.DB.batch(stmts);
  }

  return { adminRoleId, memberRoleId };
}

/* ---------- crypto for password hashing ---------- */
async function pbkdf2(password, salt, iterations = 120000, keyLen = 32, hash = "SHA-256") {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits", "deriveKey"]
  );
  const params = { name: "PBKDF2", salt, iterations, hash };
  const derivedKey = await crypto.subtle.deriveKey(
    params, keyMaterial, { name: "HMAC", hash }, true, ["sign", "verify"]
  );
  const raw = await crypto.subtle.exportKey("raw", derivedKey);
  return new Uint8Array(raw);
}
function b64(buf) {
  let str = "";
  buf.forEach(b => (str += String.fromCharCode(b)));
  return btoa(str);
}

/* ------------- CORS / preflight ------------- */
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

/* ------------- GET: list users with role & counts ------------- */
/* ------------- GET: list users with role & counts ------------- */
export async function onRequestGet(ctx) {
  try {
    const { env, request } = ctx;
    ensureDB(env);

    const auth = await getAuthed(env, request);
    if (!auth?.ok) return json({ error: "unauthorized" }, 401);

    const org_id = getOrgId(auth);
    if (!org_id) return json({ error: "missing org_id" }, 400);

    // NOTE: Every ?1 below is the same org_id; we bind it ONCE at the end.
    const stmt = env.DB.prepare(`
      SELECT
        u.id,
        u.email,
        COALESCE(u.name, u.email) AS name,
        u.username,
        u.avatar_url,             -- required for Users (avatar) column
        u.nickname,               -- required for Nickname column
        u.use_nickname,           -- not used for display here, but included for parity

        /* role: prefer roles.name, else user_orgs.role */
        COALESCE(r.name, uo.role, 'Member') AS role,

        /* owners display as "Owner" in UI */
        CASE WHEN uo.role = 'Owner' THEN 1 ELSE 0 END AS is_owner,

        /* counts for caret buttons */
        IFNULL((
          SELECT COUNT(*) FROM department_members dm
          JOIN departments d ON d.id = dm.department_id
          WHERE d.org_id = ?1 AND dm.user_id = u.id
        ), 0) AS dept_count,

        IFNULL((
          SELECT COUNT(*) FROM group_members gm
          JOIN groups g ON g.id = gm.group_id
          WHERE g.org_id = ?1 AND gm.user_id = u.id
        ), 0) AS group_count,

        IFNULL((
          SELECT COUNT(*) FROM role_permissions rp
          WHERE rp.role_id = ur.role_id
        ), 0) AS perm_count,

        /* names for dropdowns (JSON arrays) */
        IFNULL((
          SELECT json_group_array(d.name)
          FROM department_members dm
          JOIN departments d ON d.id = dm.department_id
          WHERE d.org_id = ?1 AND dm.user_id = u.id
        ), json('[]')) AS dept_names_json,

        IFNULL((
          SELECT json_group_array(g.name)
          FROM group_members gm
          JOIN groups g ON g.id = gm.group_id
          WHERE g.org_id = ?1 AND gm.user_id = u.id
        ), json('[]')) AS group_names_json,

        /* permission keys for dropdown (JSON array) */
        IFNULL((
          SELECT json_group_array(p.key)
          FROM role_permissions rp
          JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = ur.role_id
        ), json('[]')) AS perms_json

      FROM user_orgs uo
      JOIN users u ON u.id = uo.user_id
      LEFT JOIN user_roles ur
        ON ur.org_id = uo.org_id AND ur.user_id = uo.user_id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE uo.org_id = ?1
      ORDER BY lower(COALESCE(u.name, u.email)) ASC, lower(u.email) ASC
    `);

    const { results } = await stmt.bind(org_id).all(); // bind once for ?1
    return json(results ?? [], 200);
  } catch (e) {
    console.error("[users][GET] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}


/* ------------- POST: create user (+ custom role/permissions) ------------- */
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
    const id = body?.id || crypto.randomUUID();
    const email = body?.email?.trim()?.toLowerCase?.() || null;
    const name = body?.name?.trim?.() || body?.display_name?.trim?.() || email || "New User";
    const roleName = (body?.role || '').trim() || 'Member';   // 'Admin' | 'Member' | 'Custom' | 'Owner'
    const group_ids = Array.isArray(body?.group_ids) ? body.group_ids : [];
    const dept_ids = Array.isArray(body?.dept_ids) ? body.dept_ids : [];          // ← FIX
    const permission_ids = Array.isArray(body?.permission_ids) ? body.permission_ids : [];
    const password = body?.password?.toString?.() || null;

    // Ensure baseline roles and Admin->all permissions
    const { adminRoleId, memberRoleId } = await ensureOrgBasics(env, org_id);

    const stmts = [];

    // Password hashing if provided
    let pwd_hash = null, pwd_salt_b64 = null;
    if (password) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await pbkdf2(password, salt);
      pwd_hash = b64(key);
      pwd_salt_b64 = b64(salt);
    }

    // Insert user if not exists (NOTE: using 'name' column, not 'display_name')
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO users (id, email, name, pwd_hash, pwd_salt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(id, email, name, pwd_hash, pwd_salt_b64)
    );

    // If user already exists: update credentials and/or name if provided
    if (password) {
      stmts.push(
        env.DB.prepare(
          `UPDATE users
             SET pwd_hash = ?, pwd_salt = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(pwd_hash, pwd_salt_b64, id)
      );
    }
    if (name) {
      stmts.push(
        env.DB.prepare(
          `UPDATE users
             SET name = COALESCE(?, name), updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(name, id)
      );
    }

    // Legacy membership record (kept for compatibility with downstream joins)
    const make_owner = (roleName === 'Owner');
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO org_user_memberships (org_id, user_id, is_owner, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
      ).bind(org_id, id, make_owner ? 1 : 0)
    );

    // Role assignment selection
    let finalRoleId = null;
    const wantsCustom = Array.isArray(permission_ids) && permission_ids.length > 0;
    const useNamedRole = !wantsCustom && roleName !== 'Custom';

    if (useNamedRole) {
      finalRoleId =
        (roleName === 'Admin')  ? adminRoleId :
        (roleName === 'Owner')  ? memberRoleId :   // ownership via oum.is_owner
        (roleName === 'Member') ? memberRoleId :
        null;
    }

    if (!finalRoleId) {
      const customRoleId = crypto.randomUUID();
      const customRoleName = `Custom:${id.slice(0,8)}`;

      stmts.push(
        env.DB.prepare(
          `INSERT INTO roles (id, org_id, name, description, is_admin, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        ).bind(customRoleId, org_id, customRoleName, `Custom role for ${name}`)
      );

      for (const pid of permission_ids) {
        if (!pid) continue;
        stmts.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO role_permissions (role_id, permission_id, created_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)`
          ).bind(customRoleId, pid)
        );
      }

      finalRoleId = customRoleId;
    }

    // Assign user->role
    if (finalRoleId) {
      stmts.push(
        env.DB.prepare(
          `INSERT OR REPLACE INTO user_roles (org_id, user_id, role_id, created_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
        ).bind(org_id, id, finalRoleId)
      );
    }

    // user_orgs role string mirrors selection (Admin|Member|Owner|Custom)
    stmts.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO user_orgs (user_id, org_id, role, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
      ).bind(id, org_id, roleName || 'Member')
    );

    /* Replace existing memberships in this org, then insert selected */
    stmts.push(
      env.DB.prepare(`
        DELETE FROM department_members
         WHERE user_id = ?
           AND department_id IN (SELECT id FROM departments WHERE org_id = ?)
      `).bind(id, org_id)
    );
    stmts.push(
      env.DB.prepare(`
        DELETE FROM group_members
         WHERE user_id = ?
           AND group_id IN (SELECT id FROM groups WHERE org_id = ?)
      `).bind(id, org_id)
    );

    for (const dId of dept_ids) {
      if (!dId) continue;
      stmts.push(env.DB.prepare(
        `INSERT OR IGNORE INTO department_members (department_id, user_id, created_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)`
      ).bind(dId, id));
    }
    for (const gId of group_ids) {
      if (!gId) continue;
      stmts.push(env.DB.prepare(
        `INSERT OR IGNORE INTO group_members (group_id, user_id, created_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)`
      ).bind(gId, id));
    }

    await env.DB.batch(stmts);

    // Return created/updated user (with counts) — using org_user_memberships compatibility join
    const { results } = await env.DB.prepare(
      `
      SELECT
        u.id,
        u.email,
        COALESCE(u.name, u.email) AS name,
        COALESCE(r.name, CASE WHEN oum.is_owner=1 THEN 'Owner' ELSE 'Member' END) AS role,
        IFNULL((
          SELECT COUNT(*)
          FROM group_members gm
          JOIN groups g ON g.id = gm.group_id
          WHERE g.org_id = ? AND gm.user_id = u.id
        ), 0) AS group_count,
        IFNULL((
          SELECT COUNT(*)
          FROM role_permissions rp
          WHERE rp.role_id = (
            SELECT ur.role_id FROM user_roles ur WHERE ur.org_id = ? AND ur.user_id = u.id LIMIT 1
          )
        ), 0) AS perm_count
      FROM users u
      JOIN org_user_memberships oum ON oum.user_id = u.id AND oum.org_id = ?
      LEFT JOIN user_roles ur ON ur.org_id = oum.org_id AND ur.user_id = oum.user_id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.id = ?
      `
    ).bind(org_id, org_id, org_id, id).all();

    return json({ ok: true, user: results?.[0] ?? null }, 201);
  } catch (e) {
    console.error("[users][POST] unhandled:", e);
    return json({ error: String(e), code: "UNHANDLED" }, 500);
  }
}
