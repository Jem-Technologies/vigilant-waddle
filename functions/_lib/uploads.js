// functions/_lib/uploads.js
export async function readUpload(request) {
  const ct = request.headers.get("content-type")||"";
  if (ct.startsWith("multipart/form-data")) {
    const form = await request.formData();
    const f = form.get("file");
    if (!(f instanceof File)) return { file:null };
    return { file: f, filename: f.name, contentType: f.type };
  } else {
    const buf = await request.arrayBuffer();
    const type = ct || "application/octet-stream";
    const fn = request.headers.get("X-Filename") || "upload.bin";
    return { file: new File([buf], fn, { type }), filename: fn, contentType: type };
  }
}
export function imgExt(ct){ if(!ct) return "webp"; if(ct.includes("png")) return "png"; if(ct.includes("jpeg")) return "jpg"; if(ct.includes("webp")) return "webp"; return "webp"; }
export function audioExt(ct){ if(!ct) return "ogg"; if(ct.includes("ogg")) return "ogg"; if(ct.includes("mpeg")||ct.includes("mp3")) return "mp3"; if(ct.includes("aac")) return "m4a"; if(ct.includes("wav")) return "wav"; return "ogg"; }
