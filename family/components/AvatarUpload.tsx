"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { uploadPhoto } from "@/lib/photos";
import { Avatar } from "@/components/Avatar";

/** Tap the photo to change it. Stored in the private photos bucket under members/. */
export function AvatarUpload({ name, path, memberId }: { name: string; path?: string | null; memberId?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const p = await uploadPhoto(file, "members");
      const { data, error } = memberId
        ? await supabaseBrowser().rpc("member_photo_save", { p_member_id: memberId, p_path: p })
        : await supabaseBrowser().rpc("me_prefs_save", { p_photo_path: p });
      const res = data as { ok: boolean; message?: string } | null;
      if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? "Could not save.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not upload.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button type="button" className="icon-btn relative m-0 h-auto w-auto" onClick={() => inputRef.current?.click()} disabled={busy} aria-label="Change photo">
        <Avatar name={name} path={path} size={72} />
      </button>
      <div>
        <button type="button" className="btn-ghost p-0 text-sm font-semibold text-[var(--accent)]" style={{ minHeight: 0 }} onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? "Uploading…" : path ? "Change photo" : "Add a photo"}
        </button>
        {msg && <p className="text-sm text-[var(--danger)]">{msg}</p>}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
    </div>
  );
}
