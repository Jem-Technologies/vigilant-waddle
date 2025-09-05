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
  Manager: new Set([
    "users.read.all","users.read.details",
    "groups.create","groups.edit","groups.read",
    "polls.create","events.create"
  ]),
  Member: new Set([
    "polls.create","events.create"
  ])
};

// Accept either a role string or an auth object with { role }
export function hasPerm(authOrRole, perm) {
  const role = typeof authOrRole === "string" ? authOrRole : authOrRole?.role;
  if (!role) return false;
  return ROLE_PERMS[role]?.has(perm) || false;
}

export function rolePerms(role) {
  return Array.from(ROLE_PERMS[role] || []);
}
