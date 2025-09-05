// functions/api/uploads/tone.js
import { getAuthed, json } from "../../_lib/auth.js";
import { readUpload, audioExt } from "../../_lib/uploads.js";
import { broadcast } from "../../_lib/orgHub.js";

export async function onRequestPost({ request, env }) {
  const auth = await getAuthed(env, request);
  if (!auth.ok) return json({ error:"unauthorized" }, 401);
  if (!env.BUCKET) return json({ error:"R2 BUCKET not bound" }, 500);

  const url = new URL(request.url);
  const type = (url.searchParams.get("type") || "").toLowerCase();
  if (!(type==="notification" || type==="ringtone")) return json({ error:"type must be notification|ringtone" }, 400);

  const { file, contentType } = await readUpload(request);
  if (!file) return json({ error:"missing file" }, 400);
  const ext = audioExt(contentType);
  const key = `${auth.orgSlug}/users/${auth.userId}/tones/${type}.${ext}`;
  await env.BUCKET.put(key, file.stream(), { httpMetadata:{ contentType: contentType || `audio/${ext}` } });

  if (type==="notification") {
    await env.DB.prepare(`UPDATE users SET notification_tone_url=?1, profile_version=COALESCE(profile_version,0)+1 WHERE id=?2`).bind(key, auth.userId).run();
  } else {
    await env.DB.prepare(`UPDATE users SET ringtone_url=?1, profile_version=COALESCE(profile_version,0)+1 WHERE id=?2`).bind(key, auth.userId).run();
  }

  await broadcast(env, auth.orgSlug, { type:"tone.updated", user_id: auth.userId, tone:type, url:key });
  return json({ url:key });
}
