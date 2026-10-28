"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { EntryRow, EntryType } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { newClientId, sendOrQueue } from "@/lib/offline";
import { fmtTime, fromLocalInput, toLocalInput } from "@/lib/time";
import { maxDurationMin, type When, whenToIso } from "@/lib/when";
import { WhenChips } from "@/components/WhenChips";
import { Icon } from "@/components/Icon";

const LASTED: Record<string, number[]> = { sleep: [20, 30, 45, 60, 90, 120], feed: [5, 10, 15, 20, 30] };

/**
 * "Forgot to log something?" One card that writes a finished entry into the
 * past: what, when it started, how long it lasted (for sleeps and
 * breastfeeds), and the one or two details the type needs. Collapsed to a
 * line until tapped. On a past day the time defaults to that day.
 */
export function Backfill({ subjectId, types, timezone, day, entries = [], feedIntervalMin = 180, defaultOpen = false }: { subjectId: string; types: EntryType[]; timezone: string; day: string; entries?: EntryRow[]; feedIntervalMin?: number; defaultOpen?: boolean }) {
  const me = useMe();
  const router = useRouter();
  const flags = me.member as unknown as Record<string, boolean>;
  const feedType = types.find((t) => t.key === "feed");
  const breastfeeds = !!feedType?.settings?.timer_flag && !!flags[feedType.settings.timer_flag!];
  const choices = useMemo(() => {
    const out: { key: string; label: string; icon: string | null; type: EntryType; payload: Record<string, unknown>; lasted: boolean }[] = [];
    for (const t of types) {
      if (t.key === "feed") {
        out.push({ key: "bottle", label: "Bottle", icon: t.icon, type: t, payload: { method: "Bottle" }, lasted: false });
        if (breastfeeds) out.push({ key: "breast", label: "Breastfeed", icon: t.icon, type: t, payload: { method: "Breast" }, lasted: true });
      } else if (t.key === "diaper") out.push({ key: "diaper", label: t.label, icon: t.icon, type: t, payload: {}, lasted: false });
      else if (t.key === "sleep") out.push({ key: "sleep", label: t.label, icon: t.icon, type: t, payload: {}, lasted: true });
      else if (t.key === "pump" && breastfeeds) out.push({ key: "pump", label: t.label, icon: t.icon, type: t, payload: {}, lasted: false });
    }
    return out;
  }, [types, breastfeeds]);

  const today = toLocalInput(new Date().toISOString(), timezone).slice(0, 10);
  const pastDay = day < today;
  const [open, setOpen] = useState(defaultOpen);
  const [what, setWhat] = useState<string | null>(null);
  const [when, setWhen] = useState<When>(pastDay ? { kind: "at", local: `${day}T12:00` } : { kind: "ago", min: 30 });
  const [lasted, setLasted] = useState<number | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // A nudge: nothing fed for well over the usual gap while the child was awake.
  const hint = useMemo(() => {
    if (pastDay || !feedType) return null;
    const now = Date.now();
    const feeds = entries.filter((e) => e.type_id === feedType.id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    const asleep = entries.some((e) => e.type_id === "lana.sleep" && !e.ended_at);
    const last = feeds[0];
    if (!last || asleep) return null;
    const gapMin = Math.floor((now - Date.parse(last.occurred_at)) / 60_000);
    if (gapMin < feedIntervalMin + 45 || gapMin > 12 * 60) return null;
    return `Nothing fed since ${fmtTime(last.occurred_at, timezone)}, ${Math.round(gapMin / 60 * 10) / 10} h ago. Missed one?`;
  }, [entries, feedType, feedIntervalMin, pastDay, timezone]);

  const choice = choices.find((c) => c.key === what) ?? null;
  const nowMs = Date.now();
  const startIso = whenToIso(when, nowMs, (l) => fromLocalInput(l, timezone));
  const cap = maxDurationMin(startIso, nowMs);
  const bottleQuick = (feedType?.fields.find((f) => f.key === "amount_ml")?.quick ?? [60, 90, 120, 150]) as number[];
  const milkOptions = (feedType?.fields.find((f) => f.key === "milk")?.options ?? []) as string[];
  const diaperKinds = (types.find((t) => t.key === "diaper")?.fields.find((f) => f.key === "kind")?.options ?? ["Wet", "Dirty", "Both"]) as string[];
  const pumpQuick = (types.find((t) => t.key === "pump")?.fields.find((f) => f.key === "amount_ml")?.quick ?? [90, 120, 150, 180]) as number[];
  const ready = !!choice && (!choice.lasted || lasted != null) && (choice.key !== "bottle" || detail.amount_ml != null) && (choice.key !== "diaper" || !!detail.kind) && (choice.key !== "pump" || detail.amount_ml != null) && (choice.key !== "breast" || !!detail.side);
  // A greyed-out Save says what it still needs, so it never looks broken.
  const missing =
    choice && choice.lasted && lasted == null ? "Pick how long"
    : choice && (choice.key === "bottle" || choice.key === "pump") && detail.amount_ml == null ? "Pick an amount"
    : choice?.key === "diaper" && !detail.kind ? "Pick wet or dirty"
    : choice?.key === "breast" && !detail.side ? "Pick a side"
    : "Save";

  async function save() {
    if (!choice || !ready) return;
    setBusy(true);
    setMsg(null);
    const endIso = choice.lasted && lasted != null ? new Date(Date.parse(startIso) + Math.min(lasted, cap || lasted) * 60_000).toISOString() : null;
    const payload = { ...choice.payload, ...detail, ...(choice.key === "breast" && lasted != null ? { duration_min: lasted } : {}) };
    const r = await sendOrQueue(supabaseBrowser(), { client_id: newClientId(), subject_id: subjectId, type_id: choice.type.id, occurred_at: startIso, ended_at: endIso, payload, note: null });
    if (r.status === "saved" && choice.key === "pump" && detail.amount_ml) await supabaseBrowser().rpc("milk_add", { p_amount_ml: detail.amount_ml, p_location: "fridge", p_pumped_at: startIso, p_note: null });
    setBusy(false);
    if (r.status === "error") return setMsg(r.message);
    setMsg(`${choice.label} saved for ${fmtTime(startIso, timezone)}${endIso ? ` to ${fmtTime(endIso, timezone)}` : ""}${r.status === "queued" ? " (will send when back online)" : ""}.`);
    setWhat(null);
    setLasted(null);
    setDetail({});
    setWhen(pastDay ? { kind: "at", local: `${day}T12:00` } : { kind: "ago", min: 30 });
    router.refresh();
  }

  if (!can(me, "lana", "add") || choices.length === 0) return null;
  if (!open) {
    return (
      <button type="button" className={`card flex items-center gap-3 text-left ${hint ? "ring-2 ring-[var(--warn)]" : ""}`} onClick={() => setOpen(true)}>
        <Icon name="history" size={22} className="shrink-0 text-[var(--accent)]" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{hint ?? (pastDay ? "Add something to this day" : "Forgot to log something?")}</span>
          <span className="muted block text-sm">{hint ? "Add it from earlier in a few taps." : "A feed, a nappy or a nap from earlier, in a few taps."}</span>
        </span>
        <span aria-hidden className="muted">
          ›
        </span>
      </button>
    );
  }
  return (
    <section className="card flex flex-col gap-3" aria-labelledby="backfill-h">
      <div className="flex items-baseline justify-between">
        <h2 id="backfill-h" className="font-semibold">
          {pastDay ? `Add to ${day}` : "Log something from earlier"}
        </h2>
        <button type="button" className="text-sm font-semibold text-[var(--accent)]" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      {hint && <p className="notice notice-warn text-sm">{hint}</p>}
      <div className="flex flex-wrap gap-2" role="group" aria-label="What">
        {choices.map((c) => (
          <button key={c.key} type="button" className="chip min-h-[48px]" aria-pressed={what === c.key} disabled={busy} onClick={() => { setWhat(c.key); setLasted(null); setDetail({}); }}>
            <span aria-hidden>{c.icon}</span> {c.label}
          </button>
        ))}
      </div>
      {choice && (
        <>
          <p className="muted text-sm">{choice.lasted ? "Started" : "When"}</p>
          <WhenChips value={when} onChange={setWhen} timezone={timezone} presets={pastDay ? [] : [15, 30, 45, 60, 90, 120, 180]} alwaysOpen />
          {choice.lasted && (
            <>
              <p className="muted text-sm">Lasted{cap > 0 && cap < 180 ? ` (up to ${cap} min, until now)` : ""}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="How long">
                {(LASTED[choice.key === "breast" ? "feed" : "sleep"] ?? []).filter((m) => cap === 0 || m <= cap || m === LASTED.feed[0]).map((m) => (
                  <button key={m} type="button" className="chip" aria-pressed={lasted === m} disabled={busy} onClick={() => setLasted(m)}>
                    {m} min
                  </button>
                ))}
              </div>
            </>
          )}
          {choice.key === "bottle" && (
            <>
              {milkOptions.length > 0 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Which milk">
                  {milkOptions.map((m) => (
                    <button key={m} type="button" className="chip" aria-pressed={detail.milk === m} disabled={busy} onClick={() => setDetail({ ...detail, milk: m })}>
                      {m}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2" role="group" aria-label="How much">
                {bottleQuick.map((ml) => (
                  <button key={ml} type="button" className="chip" aria-pressed={detail.amount_ml === ml} disabled={busy} onClick={() => setDetail({ ...detail, amount_ml: ml })}>
                    {ml} ml
                  </button>
                ))}
              </div>
            </>
          )}
          {choice.key === "breast" && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Which side">
              {["Left", "Right", "Both"].map((s) => (
                <button key={s} type="button" className="chip" aria-pressed={detail.side === s} disabled={busy} onClick={() => setDetail({ ...detail, side: s })}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {choice.key === "diaper" && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="What kind">
              {diaperKinds.map((k) => (
                <button key={k} type="button" className="chip" aria-pressed={detail.kind === k} disabled={busy} onClick={() => setDetail({ ...detail, kind: k })}>
                  {k}
                </button>
              ))}
            </div>
          )}
          {choice.key === "pump" && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="How much">
              {pumpQuick.map((ml) => (
                <button key={ml} type="button" className="chip" aria-pressed={detail.amount_ml === ml} disabled={busy} onClick={() => setDetail({ ...detail, amount_ml: ml })}>
                  {ml} ml
                </button>
              ))}
            </div>
          )}
          <button type="button" className="btn btn-primary min-h-[56px]" disabled={!ready || busy} onClick={() => void save()}>
            {ready ? `Save ${choice.label.toLowerCase()} at ${fmtTime(startIso, timezone)}` : missing}
          </button>
          <p className="muted text-xs">Need more detail, a note or a photo? Use the full form from the buttons below; it has a time field too.</p>
        </>
      )}
      {msg && (
        <p role="status" className="notice notice-ok text-sm">
          {msg}
        </p>
      )}
    </section>
  );
}
