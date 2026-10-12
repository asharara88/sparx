"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LANGS, type Lang } from "@/lib/i18n";

/** Me: language for the simple screen and the voice helper, and the simple screen itself. */
export function PrefsForm({ lang, simple }: { lang: Lang; simple: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function save(args: { p_lang?: Lang; p_simple_mode?: boolean }) {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("me_prefs_save", args);
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    router.refresh();
  }
  return (
    <section className="card flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Language</h2>
        <p className="muted text-sm">For the simple screen and when you speak to Ask.</p>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Language">
          {LANGS.map((l) => (
            <button key={l.id} type="button" className="chip" aria-pressed={lang === l.id} disabled={busy} onClick={() => save({ p_lang: l.id })}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block font-semibold">Simple screen</span>
          <span className="muted text-sm">Four big buttons instead of the full home screen.</span>
        </span>
        <input type="checkbox" className="h-7 w-7" style={{ minHeight: 0 }} checked={simple} disabled={busy} onChange={(e) => save({ p_simple_mode: e.target.checked })} />
      </label>
      {msg && <p className="text-sm text-[var(--danger)]">{msg}</p>}
    </section>
  );
}
