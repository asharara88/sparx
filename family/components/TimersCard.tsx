"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EntryType, OngoingEntry } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { can } from "@/lib/types";
import { fmtDuration, fmtTime, minutesBetween } from "@/lib/time";
import { supabaseBrowser } from "@/lib/supabase/client";
import { newClientId } from "@/lib/offline";

/**
 * One-tap timers: Sleep, Night wake-up, Breastfeed (left/right, only for a
 * member flagged as breastfeeding). A running timer is an open entry; Stop
 * sets its end time.
 */
export function TimersCard({
  subjectId,
  types,
  ongoing,
  timezone,
}: {
  subjectId: string;
  types: EntryType[];
  ongoing: OngoingEntry[];
  timezone: string;
}) {
  const me = useMe();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const canAdd = can(me, "lana", "add");
  const timerTypes = types.filter((t) => t.settings?.timer && t.is_active);
  const flags = me.member as unknown as Record<string, unknown>;
  const now = new Date().toISOString();

  async function start(t: EntryType, choice?: string) {
    setBusy(t.id);
    const payload = { ...(t.settings.timer_payload ?? {}) } as Record<string, unknown>;
    if (t.settings.timer_choice && choice) payload[t.settings.timer_choice.key] = choice;
    const { data, error } = await supabaseBrowser().rpc("care_entry_log", {
      p_subject_id: subjectId,
      p_type_id: t.id,
      p_occurred_at: new Date().toISOString(),
      p_ended_at: null,
      p_payload: payload,
      p_note: null,
      p_client_id: newClientId(),
    });
    setBusy(null);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return alert(res?.message ?? error?.message ?? "Could not start.");
    router.refresh();
  }

  async function stop(e: OngoingEntry) {
    setBusy(e.id);
    const { data, error } = await supabaseBrowser().rpc("care_entry_end", { p_id: e.id, p_ended_at: new Date().toISOString() });
    setBusy(null);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return alert(res?.message ?? error?.message ?? "Could not stop.");
    router.refresh();
  }

  if (timerTypes.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {ongoing.map((e) => {
        const t = types.find((x) => x.id === e.type_id);
        const label = t?.settings?.timer_label ?? t?.label ?? "Timer";
        const choice = t?.settings?.timer_choice ? String(e.payload[t.settings.timer_choice.key] ?? "") : "";
        return (
          <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-purple-700 bg-purple-50 p-3">
            <div>
              <p className="font-semibold">
                <span aria-hidden>{t?.icon} </span>
                {label}
                {choice ? ` · ${choice}` : ""} since {fmtTime(e.occurred_at, timezone)}
              </p>
              <p className="muted text-sm">{fmtDuration(minutesBetween(e.occurred_at, now))} so far</p>
            </div>
            {canAdd && (
              <button className="btn btn-primary" onClick={() => stop(e)} disabled={busy === e.id}>
                {busy === e.id ? "…" : "Stop"}
              </button>
            )}
          </div>
        );
      })}

      {canAdd && (
        <div className="flex flex-wrap gap-2">
          {timerTypes.map((t) => {
            if (t.settings.timer_flag && !flags[t.settings.timer_flag]) return null;
            if (ongoing.some((e) => e.type_id === t.id)) return null;
            const label = t.settings.timer_label ?? t.label;
            if (t.settings.timer_choice) {
              return t.settings.timer_choice.options.map((o) => (
                <button key={t.id + o} className="chip" onClick={() => start(t, o)} disabled={busy === t.id}>
                  <span aria-hidden>{t.icon} </span>
                  {label} {o}
                </button>
              ));
            }
            return (
              <button key={t.id} className="chip" onClick={() => start(t)} disabled={busy === t.id}>
                <span aria-hidden>{t.icon} </span>Start {label.toLowerCase()}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
