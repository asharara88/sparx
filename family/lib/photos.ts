"use client";
import { supabaseBrowser } from "@/lib/supabase/client";

const BUCKET = "photos";

/**
 * Shrink a phone photo before upload: longest side 1600px, JPEG. A 4 MB camera
 * shot becomes ~300 KB, which uploads on house wifi, reads faster on the phone,
 * and stays well under the size the model accepts. Falls back to the original.
 */
export async function downscale(file: File, maxSide = 1600): Promise<Blob> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap === "undefined") return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

let homeId: Promise<string> | null = null;

/** The signed-in member's home, asked once per page load: photos live in the home's own folder. */
function myHome(): Promise<string> {
  if (homeId) return homeId;
  const p: Promise<string> = supabaseBrowser()
    .rpc("me")
    .then(({ data }: { data: unknown }) => {
      const id = (data as { ok?: boolean; household?: { id?: string } } | null)?.household?.id;
      if (!id) {
        homeId = null;
        throw new Error("Sign in again before adding a photo.");
      }
      return id;
    });
  homeId = p;
  return p;
}

/** Upload a photo from a file input. Returns the storage path to keep on the row. */
export async function uploadPhoto(file: File, folder: "entries" | "subjects" | "members" | "chat"): Promise<string> {
  const home = await myHome();
  const blob = await downscale(file);
  const ext = blob === file ? (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg" : "jpg";
  const path = `home-${home}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseBrowser().storage.from(BUCKET).upload(path, blob, {
    contentType: blob === file ? file.type || "image/jpeg" : "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

/** A short-lived URL to show a private photo. */
export async function photoUrl(path: string): Promise<string | null> {
  const { data } = await supabaseBrowser().storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}
