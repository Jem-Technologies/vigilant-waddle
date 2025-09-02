// /functions/_lib/tenant.js  (create this folder/file)
export function getOrgSlugFromUrl(url) {
  try {
    const u = new URL(url);
    // supports /o/{slug}/... or /organization/{slug}/...
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.findIndex(p => p === "o" || p === "organization");
    if (i >= 0 && parts[i+1]) return parts[i+1].toLowerCase();
    return null;
  } catch { return null; }
}
