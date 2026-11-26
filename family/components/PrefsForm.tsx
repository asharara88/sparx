"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LANGS, type Lang } from "@/lib/i18n";

/**
 * Display: language for the simple screen and the voice helper, the simple screen and large
 * text. `children` go last in the same card, so the night switch (saved on this phone, not
 * the account) sits with the other two. A parent in a home with another parent also gets
 * "Tell ... about my nights" (DESIGN.md, "Cheers and shared nights"): hers to turn on and off.
 */
export function PrefsForm({ lang, simple, large, nights = null, children }: { lang: Lang; simple: boolean; large: boolean; /** Her own switch for sharing her nights (migration 7000), where there is another parent to tell; null hides the row. */ nights?: { on: boolean; names: string } | null; children?: React.ReactNode }) {
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
      <label className="flex min-h-[44px] items-center justify-between gap-3">
        <span>
          <span className="block font-semibold">Simple screen</span>
          <span className="muted text-sm">Four big buttons instead of the full home screen.</span>
        </span>
        <input type="checkbox" checked={simple} disabled={busy} onChange={(e) => save({ p_simple_mode: e.target.checked })} />
      </label>
      <label className="flex min-h-[44px] items-center justify-between gap-3">
        <span>
          <span className="block font-semibold">Large text</span>
          <span className="muted text-sm">Bigger everywhere.</span>
        </span>
        <input
          type="checkbox"
          checked={large}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            const { data, error } = await supabaseBrowser().rpc("me_large_text_set", { p_large_text: e.target.checked });
            setBusy(false);
            const res = data as { ok: boolean; message?: string } | null;
            if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
            router.refresh();
          }}
        />
      </label>
      {nights && (
        <label className="flex min-h-[44px] items-center justify-between gap-3">
          <span>
            <span className="block font-semibold">Tell {nights.names} about my nights</span>
            <span className="muted text-sm">One line the morning after: times up and the longest quiet stretch.</span>
          </span>
          <input
            type="checkbox"
            checked={nights.on}
            disabled={busy}
            onChange={async (e) => {
              setBusy(true);
              setMsg(null);
              const { data, error } = await supabaseBrowser().rpc("me_night_share_set", { p_on: e.target.checked });
              setBusy(false);
              const res = data as { ok: boolean; message?: string } | null;
              if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
              router.refresh();
            }}
          />
        </label>
      )}
      {children}
      {msg && <p className="text-sm text-[var(--danger)]">{msg}</p>}
    </section>
  );
}
