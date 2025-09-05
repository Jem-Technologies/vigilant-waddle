// functions/api/cdn/[...path].js
export async function onRequestGet({ env, params }) {
  if (!env.BUCKET) return new Response('R2 not bound', { status: 500 });
  const key = decodeURIComponent((params?.path || []).join('/'));
  const obj = await env.BUCKET.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const ct = obj.httpMetadata?.contentType || 'application/octet-stream';
  return new Response(obj.body, { headers: { 'content-type': ct } });
}
