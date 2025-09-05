// functions/api/uploads/message.js
export async function onRequestPost({ request, env }){
  const { getAuthed, json } = await import("../../_lib/auth.js");
  const { readUpload } = await import("../../_lib/uploads.js");

  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error: "unauthorized" }, 401);
  if (!env.BUCKET) return json({ error: "R2 BUCKET not bound" }, 500);

  const { file, filename, contentType } = await readUpload(request);
  if (!file) return json({ error: "missing file" }, 400);

  const now = Date.now();
  const safe = (filename || "upload.bin").replace(/[^a-zA-Z0-9_.-]+/g, "-");
  const key = `${auth.orgSlug}/threads/${now}-${crypto.randomUUID()}-${safe}`;

  await env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: contentType || "application/octet-stream" }
  });
  return json({ url: key, contentType: contentType || "application/octet-stream" });
}
