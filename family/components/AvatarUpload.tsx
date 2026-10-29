"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { uploadPhoto } from "@/lib/photos";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";

/**
 * Tap the photo to change it. Stored in the private photos bucket: a member's under
 * members/, the child's under subjects/ and kept on the child's profile (photo_path)
 * through subject_profile_save, which checks the caller may edit the child's details.
 * `compact` is the photo alone with a small camera badge, for a page header.
 */
export function AvatarUpload({
  name,
  path,
  memberId,
  subject,
  size = 72,
  compact = false,
}: {
  name: string;
  path?: string | null;
  memberId?: string;
  subject?: { id: string; profile: Record<string, unknown> | null };
  size?: number;
  compact?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const p = await uploadPhoto(file, subject ? "subjects" : "members");
      const { data, error } = subject
        ? await supabaseBrowser().rpc("subject_profile_save", { p_subject_id: subject.id, p_profile: { ...(subject.profile ?? {}), photo_path: p }, p_birth_date: null, p_name: null })
        : memberId
          ? await supabaseBrowser().rpc("member_photo_save", { p_member_id: memberId, p_path: p })
          : await supabaseBrowser().rpc("me_prefs_save", { p_photo_path: p });
      const res = data as { ok: boolean; message?: string } | null;
      if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? "Could not save.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not upload.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const input = <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />;

  if (compact) {
    return (
      <div className="relative shrink-0">
        <button type="button" className="relative block rounded-full" onClick={() => inputRef.current?.click()} disabled={busy} aria-label={path ? `Change ${name}'s photo` : `Add a photo of ${name}`}>
          <Avatar name={name} path={path} size={size} />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--bg)] bg-[var(--accent)] text-[var(--accent-fg)]" aria-hidden>
            <Icon name={busy ? "clock" : "camera"} size={14} />
          </span>
        </button>
        {msg && <p className="absolute left-0 top-full mt-1 w-48 text-sm text-[var(--danger)]">{msg}</p>}
        {input}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button type="button" className="icon-btn relative m-0 h-auto w-auto" onClick={() => inputRef.current?.click()} disabled={busy} aria-label="Change photo">
        <Avatar name={name} path={path} size={size} />
      </button>
      <div>
        <button type="button" className="btn-ghost p-0 text-sm font-semibold text-[var(--accent)]" style={{ minHeight: 0 }} onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? "Uploading…" : path ? "Change photo" : "Add a photo"}
        </button>
        {msg && <p className="text-sm text-[var(--danger)]">{msg}</p>}
      </div>
      {input}
    </div>
  );
}
