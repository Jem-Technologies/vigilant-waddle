// functions/_lib/perm.js
// Minimal, server-side permission layer mapped from role.
// Phase 2 can move this to tables; for now, keep it here.

export const ROLE_PERMS = {
  Admin: new Set([
    "users.create","users.edit","users.delete","users.disable","users.read.all","users.read.details",
    "groups.create","groups.edit","groups.delete","groups.read",
    "messages.delete","messages.pin","files.manage","polls.create","events.create",
    "system.settings.manage","system.audit.view","system.permissions.manage","system.reports.export"
  ]),
  // Treat Owner as full admin
  Owner: new Set([
    "users.create","users.edit","users.delete","users.disable","users.read.all","users.read.details",
    "groups.create","groups.edit","groups.delete","groups.read",
    "messages.delete","messages.pin","files.manage","polls.create","events.create",
    "system.settings.manage","system.audit.view","system.permissions.manage","system.reports.export"
  ]),
  Manager: new Set([
    "users.read.all","users.read.details",
    "groups.create","groups.edit","groups.read",
    "polls.create","events.create"
  ]),
  Member: new Set([
    // minimal default permissions for regular members
    "groups.read"
  ])
};

// Normalize varied role spellings (e.g., 'owner', 'Admin')
export function canonicalRole(role) {
  const r = String(role || "").trim();
  if (!r) return "";
  const low = r.toLowerCase();
  if (low === "owner" || low === "admin") return "Admin"; // Owners are admins
  if (low === "manager") return "Manager";
  return "Member";
}

// Accept either a role string or an auth object with { role }
export function hasPerm(authOrRole, perm) {
  const roleInput = typeof authOrRole === "string" ? authOrRole : (authOrRole?.role ?? "");
  const role = canonicalRole(roleInput);
  if (!role) return false;
  return ROLE_PERMS[role]?.has(perm) || false;
}

export function rolePerms(role) {
  return Array.from(ROLE_PERMS[canonicalRole(role)] || []);
}
