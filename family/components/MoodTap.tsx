"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EntryRow } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { newClientId } from "@/lib/offline";
import { fmtTime } from "@/lib/time";
import { childName } from "@/lib/names";

export const MOODS = [
  { key: "Happy", face: "😊" },
  { key: "Calm", face: "😌" },
  { key: "Fussy", face: "😣" },
  { key: "Unsettled", face: "😢" },
] as const;

/**
 * One tap for how the child is right now. It lands on the day like any entry, so the week's
 * pattern can set it against sleep. `bare` is the faces alone, for inside the log sheet.
 */
export function MoodTap({ subjectId, today, timezone, bare = false }: { subjectId: string; today: EntryRow[]; timezone: string; bare?: boolean }) {
  const me = useMe();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!can(me, "lana", "add")) return null;
  const moods = today.filter((e) => e.type_id === "lana.mood").sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  async function tap(mood: string) {
    setBusy(mood);
    setError(null);
    const { data } = await supabaseBrowser().rpc("care_entry_log", { p_subject_id: subjectId, p_type_id: "lana.mood", p_occurred_at: new Date().toISOString(), p_ended_at: null, p_payload: { mood }, p_note: null, p_client_id: newClientId() });
    setBusy(null);
    if (!(data as { ok?: boolean } | null)?.ok) setError((data as { message?: string } | null)?.message ?? "Could not save.");
    else router.refresh();
  }

  return (
    <section className={bare ? "" : "card"} aria-labelledby="mood-h">
      <div className={`flex items-baseline justify-between ${bare ? "text-sm" : ""}`}>
        <h2 id="mood-h" className="font-semibold">
          How is {childName(me)} right now?
        </h2>
        {moods.length > 0 && <span className="muted text-xs">{moods.length} today</span>}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {MOODS.map((m) => (
          <button key={m.key} type="button" className="btn flex-col gap-0 py-2" disabled={busy != null} aria-label={m.key} onClick={() => void tap(m.key)}>
            <span className="text-2xl" aria-hidden>
              {m.face}
            </span>
            <span className="text-xs">{m.key}</span>
          </button>
        ))}
      </div>
      {error && <p className="notice notice-warn mt-2 text-sm">{error}</p>}
      {moods.length > 0 && (
        <p className="muted mt-2 text-sm">
          {moods.map((e) => `${MOODS.find((m) => m.key === e.payload.mood)?.face ?? "·"} ${fmtTime(e.occurred_at, timezone)}`).join("  ")}
        </p>
      )}
    </section>
  );
}
