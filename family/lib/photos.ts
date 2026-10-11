"use client";
import { supabaseBrowser } from "@/lib/supabase/client";

const BUCKET = "photos";

/** Upload a photo from a file input. Returns the storage path to keep on the row. */
export async function uploadPhoto(file: File, folder: "requests" | "items" | "entries" | "tickets" | "assets" | "subjects"): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseBrowser().storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
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
