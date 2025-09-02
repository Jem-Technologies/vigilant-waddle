// functions/_lib/tenant.js
export function getOrgSlugFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const parts = u.pathname.split("/").filter(Boolean);
    // supports /o/{slug}/... or /organization/{slug}/...
    const i = parts.findIndex(p => p === "o" || p === "organization");
    if (i >= 0 && parts[i + 1]) return parts[i + 1].toLowerCase();
    return null;
  } catch {
    return null;
  }
}
export function slugify(x) {
  return String(x || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
export function capitalize(s){ s=String(s||""); return s ? s[0].toUpperCase()+s.slice(1) : s; }
