// functions/api/uploads/avatar.js
import { getAuthed, json } from "../../_lib/auth.js";
import { readUpload, imgExt } from "../../_lib/uploads.js";
import { broadcast } from "../../_lib/orgHub.js";

export async function onRequestPost({ request, env }) {
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error:"unauthorized" }, 401);
  if (!env.BUCKET) return json({ error:"R2 BUCKET not bound" }, 500);

  const { file, contentType } = await readUpload(request);
  if (!file) return json({ error:"missing file" }, 400);
  const ext = imgExt(contentType);
  const key = `${auth.orgSlug}/users/${auth.userId}/avatar.${ext}`;
  await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: contentType || `image/${ext}` } });
  await env.DB.prepare(`UPDATE users SET avatar_url=?1, avatar_updated_at=unixepoch(), profile_version=COALESCE(profile_version,0)+1 WHERE id=?2`)
    .bind(key, auth.userId).run();

  await broadcast(env, auth.orgSlug, { type:"profile.updated", user_id: auth.userId, field:"avatar_url", url:key });
  return json({ url:key });
}
