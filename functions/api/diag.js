export async function onRequestGet({ env }) {
  const out = { hasDB: !!env.DB, tables: null, err: null };
  if (!env.DB) return resp(out, 500);
  try {
    const rows = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();
    out.tables = rows.results;
    return resp(out, 200);
  } catch (e) {
    out.err = String(e?.message || e);
    return resp(out, 500);
  }
}
function resp(obj, status=200){
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
