// functions/_lib/orgHub.js
// Optional: broadcast to a Worker-based OrgHub Durable Object (if configured)
// Set ORG_WS_BASE in your Pages project settings to the Worker origin, e.g., https://org-hub.example.workers.dev
export async function broadcast(env, orgSlug, payload) {
  const base = env.ORG_WS_BASE || ""; // e.g., https://org-hub.example.workers.dev
  if (!base) return false;
  try {
    const url = new URL("/broadcast", base);
    return await fetch(url.toString(), { method:"POST", body: JSON.stringify(payload), headers: { "content-type":"application/json" }})
      .then(r=>r.ok);
  } catch { return false; }
}
