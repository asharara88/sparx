"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EntryRow, EntryType, OngoingEntry, Subject } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { can } from "@/lib/types";
import { fmtDuration, fmtTime, minutesBetween } from "@/lib/time";
import { supabaseBrowser } from "@/lib/supabase/client";
import { endOrQueue, mergeOngoing, newClientId, onQueueChange, readQueueFor, sendOrQueue, type QueuedOp } from "@/lib/offline";
import { Boobs } from "./Boobs";
import { Icon } from "@/components/Icon";
import { WhenChips } from "@/components/WhenChips";
import { NOW, type When, whenToIso, isEarlier } from "@/lib/when";
import { fromLocalInput } from "@/lib/time";
import { possessive } from "@/lib/names";
import { isNightAt } from "@/lib/night";

/**
 * The child's screen follows the child's state: asleep, awake, feeding, awake at night.
 * Every tap logs straight away. Timers are open entries (no end time yet).
 */
type State =
  | { kind: "asleep"; entry: OngoingEntry }
  | { kind: "feeding"; entry: OngoingEntry; side: string }
  | { kind: "night_awake"; entry: OngoingEntry }
  | { kind: "awake"; since: string | null };

export function LanaNow({
  subject,
  types,
  ongoing: serverOngoing,
  recent,
  timezone,
  lastMilk,
}: {
  subject: Subject;
  types: EntryType[];
  ongoing: OngoingEntry[];
  recent: EntryRow[];
  timezone: string;
  lastMilk: string | null;
}) {
  const me = useMe();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [milk, setMilk] = useState<string>(lastMilk ?? "Morning pumped");
  // "When": now by default; "20 min ago" when the tap comes late. Every tap below honours it.
  const [when, setWhen] = useState<When>(NOW);
  // The sheet a tile opened (feed, nappy, pump); closes when the tap saves.
  const [sheet, setSheet] = useState<"feed" | "diaper" | "pump" | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  // Timers waiting on this phone count as running too (read after mount, so the
  // server-rendered screen and the first client render agree).
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  useEffect(() => {
    const sb = supabaseBrowser();
    const load = () => void readQueueFor(sb).then(setQueue);
    load();
    return onQueueChange(load);
  }, []);
  const ongoing = mergeOngoing(serverOngoing, subject.id, queue, me.member.display_name, types);
  const queuedRef = useRef(false);

  const canAdd = can(me, "lana", "add");
  const flags = me.member as unknown as Record<string, boolean>;
  const feedType = types.find((t) => t.key === "feed");
  const sleepType = types.find((t) => t.key === "sleep");
  const wakeType = types.find((t) => t.key === "wake");
  const diaperType = types.find((t) => t.key === "diaper");
  const pumpType = types.find((t) => t.key === "pump");
  const breastfeeds = !!feedType?.settings?.timer_flag && !!flags[feedType.settings.timer_flag!];
  const bottleQuick = (feedType?.fields.find((f) => f.key === "amount_ml")?.quick ?? [60, 90, 120, 150]) as number[];
  const milkOptions = (feedType?.fields.find((f) => f.key === "milk")?.options ?? []) as string[];
  const now = new Date();
  const whenIso = whenToIso(when, now.getTime(), (l) => fromLocalInput(l, timezone));
  const nowIso = whenIso;

  // ---- what is the child doing right now?
  const openSleep = ongoing.find((e) => e.type_id === sleepType?.id);
  const openFeed = ongoing.find((e) => e.type_id === feedType?.id);
  const openWake = ongoing.find((e) => e.type_id === wakeType?.id);
  const lastSleep = recent.find((e) => e.type_id === sleepType?.id && e.ended_at);
  const breastFeeds = recent.filter((e) => e.type_id === feedType?.id && e.payload.method === "Breast");
  const lastSide = (breastFeeds[0]?.payload.side as "Left" | "Right" | undefined) ?? null;
  const suggestedSide: "Left" | "Right" | null = lastSide === "Left" ? "Right" : lastSide === "Right" ? "Left" : null;
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  const sideCounts = { Left: 0, Right: 0 };
  for (const f of breastFeeds) {
    if (new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(f.occurred_at)) !== todayKey) continue;
    if (f.payload.side === "Left") sideCounts.Left += 1;
    if (f.payload.side === "Right") sideCounts.Right += 1;
  }
  const state: State = openFeed
    ? { kind: "feeding", entry: openFeed, side: String(openFeed.payload.side ?? "") }
    : openSleep
      ? { kind: "asleep", entry: openSleep }
      : openWake
        ? { kind: "night_awake", entry: openWake }
        : { kind: "awake", since: lastSleep?.ended_at ?? null };

  const isNight = isNightAt(now, timezone, subject.settings);

  // ---- actions
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await supabaseBrowser().rpc(name, args);
    const res = data as { ok: boolean; message?: string; id?: string } | null;
    if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? "Could not save.");
    return res;
  }
  // Starts and ends go through the offline queue: with no signal the tap is kept on the
  // phone and sent later, and the screen shows the timer as running meanwhile.
  async function start(type: EntryType | undefined, payload: Record<string, unknown> = {}, endedAt: string | null = null) {
    if (!type) throw new Error("That kind of entry is switched off.");
    const r = await sendOrQueue(supabaseBrowser(), {
      client_id: newClientId(),
      subject_id: subject.id,
      type_id: type.id,
      occurred_at: nowIso,
      ended_at: endedAt,
      payload,
      note: null,
    });
    if (r.status === "error") throw new Error(r.message);
    if (r.status === "queued") queuedRef.current = true;
    return r;
  }
  async function end(entry: OngoingEntry) {
    if (Date.parse(whenIso) < Date.parse(entry.occurred_at)) {
      throw new Error(`That is before it started at ${fmtTime(entry.occurred_at, timezone)}. Pick a later time.`);
    }
    const r = await endOrQueue(supabaseBrowser(), entry.id, whenIso);
    if (r.status === "error") throw new Error(r.message);
    if (r.status === "queued") queuedRef.current = true;
    return r;
  }
  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setMsg(null);
    queuedRef.current = false;
    try {
      await fn();
      const base = isEarlier(when) ? `${label.replace(/\.$/, "")}, as of ${fmtTime(whenIso, timezone)}.` : label;
      setMsg(queuedRef.current ? `${base} Saved on this phone; it will send when back online.` : base);
      setWhen(NOW);
      setSheet(null);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const realNowIso = now.toISOString();
  const sinceText = (iso: string) => `${fmtTime(iso, timezone)} · ${fmtDuration(Math.max(0, minutesBetween(iso, realNowIso)))}`;

  const elapsed = (iso: string) => fmtDuration(Math.max(0, minutesBetween(iso, realNowIso)));
  // Each tile says when it last happened ("1 h 50 min ago"); a day or more is the tile's
  // plain hint instead, and a log gap of 12 hours never reads as "awake 20 h".
  const ago = (typeId: string | undefined, fallback: string) => {
    const last = typeId ? recent.find((e) => e.type_id === typeId) : undefined;
    if (!last) return fallback;
    const m = minutesBetween(last.ended_at ?? last.occurred_at, realNowIso);
    return m >= 0 && m < 24 * 60 ? `${fmtDuration(m)} ago` : fallback;
  };
  const awakeSub = state.kind === "awake" && state.since && minutesBetween(state.since, realNowIso) <= 12 * 60 ? `awake ${elapsed(state.since)}` : "Tap when asleep";

  // Closing a sheet without saving also drops a "when" picked inside it, so the next
  // direct tap (Asleep has no chips) is not quietly backdated.
  const closeSheet = () => {
    setWhen(NOW);
    setSheet(null);
  };
  const tileProps = { disabled: busy || !canAdd };
  const startSleep = () =>
    run("Sleep started.", async () => {
      if (state.kind === "night_awake") await end(state.entry);
      await start(sleepType, {});
    });

  return (
    <section className="flex flex-col gap-3" aria-live="polite">
      {msg && (
        <p role="status" className="notice notice-ok text-sm">
          {msg}
        </p>
      )}

      {/* ---- feeding: the timer, switch side or finish */}
      {state.kind === "feeding" && (
        <div className="card tint-feed flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="icon-disc">
              <Icon name="bottle" size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="action-label">Feeding{state.side ? `, ${state.side.toLowerCase()}` : ""}</p>
              <p className="text-3xl font-bold tabular-nums">{elapsed(state.entry.occurred_at)}</p>
            </div>
          </div>
          {breastfeeds && (
            <Boobs
              active={state.side === "Left" || state.side === "Right" ? state.side : null}
              elapsed={elapsed(state.entry.occurred_at)}
              suggested={null}
              counts={sideCounts}
              disabled={busy || !canAdd}
              onTap={(s) =>
                s === state.side
                  ? run("Feed saved.", () => end(state.entry))
                  : run(`Switched to ${s.toLowerCase()} boob.`, async () => {
                      await end(state.entry);
                      await start(feedType, { method: "Breast", side: s });
                    })
              }
            />
          )}
          {breastfeeds && minutesBetween(state.entry.occurred_at, realNowIso) >= 30 && (
            <p className="notice notice-warn text-center text-sm font-semibold" role="status">
              Over 30 min on one side. Timer left on? Tap the boob to stop it.
            </p>
          )}
          <button type="button" className="btn btn-primary min-h-[64px] text-lg" onClick={() => run("Feed saved.", () => end(state.entry))} disabled={busy || !canAdd}>
            <Icon name="check" size={20} /> Done feeding
          </button>
        </div>
      )}

      {/* ---- asleep: one tap wakes (a night wake-up at night) */}
      {state.kind === "asleep" && (
        <div className="flex flex-col gap-3">
          <Tile {...tileProps}
            row
            tint="sleep"
            icon="moon"
            label={`Asleep · ${elapsed(state.entry.occurred_at)}`}
            sub={`since ${fmtTime(state.entry.occurred_at, timezone)}`}
            trailing="Woke up"
            onClick={() =>
              run(isNight ? "Night wake-up started." : `Good morning, ${subject.name}.`, async () => {
                await end(state.entry);
                if (isNight && wakeType) await start(wakeType, {});
              })
            }
          />
          {isNight && <Tile {...tileProps} row tint="pump" icon="sun" label="Up for the day" onClick={() => run("Up for the day.", () => end(state.entry))} />}
        </div>
      )}

      {/* ---- awake (day or night): four tiles */}
      {(state.kind === "awake" || state.kind === "night_awake") && (
        <div className="grid grid-cols-2 gap-3">
          <Tile {...tileProps} tint="feed" icon="bottle" label="Feed" sub={ago(feedType?.id, breastfeeds ? "Breast or bottle" : "Bottle")} onClick={() => setSheet("feed")} />
          <Tile {...tileProps}
            tint="sleep"
            icon="zzz"
            label={state.kind === "night_awake" ? "Back to sleep" : "Asleep"}
            sub={state.kind === "night_awake" ? `awake since ${fmtTime(state.entry.occurred_at, timezone)}` : awakeSub}
            onClick={startSleep}
          />
          <Tile {...tileProps} tint="diaper" icon="diaper" label="Nappy" sub={ago(diaperType?.id, "Wet or dirty")} onClick={() => setSheet("diaper")} />
          {breastfeeds && pumpType ? <Tile {...tileProps} tint="pump" icon="droplet" label="Pump" sub={ago(pumpType?.id, "To the fridge")} onClick={() => setSheet("pump")} /> : <Tile {...tileProps} tint="meds" icon="clock" label="Medicine" sub="Log a dose" href="/baby/medicine" />}
        </div>
      )}

      {sheet === "feed" && (
        <Sheet title="Feed" onClose={closeSheet} when={when} onWhen={setWhen} timezone={timezone} busy={busy}>
          {breastfeeds && <Boobs active={null} elapsed={null} suggested={suggestedSide} counts={sideCounts} disabled={busy || !canAdd} onTap={(s) => run(`${s} boob started.`, () => start(feedType, { method: "Breast", side: s }))} />}
          <div className="card tint-feed flex flex-col gap-2">
            <p className="font-semibold">Bottle</p>
            {milkOptions.length > 0 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Which milk">
                {milkOptions.map((m) => (
                  <button key={m} type="button" className="chip" aria-pressed={milk === m} onClick={() => setMilk(m)} disabled={busy}>
                    {m}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {bottleQuick.map((ml) => (
                <button
                  key={ml}
                  type="button"
                  className="chip min-h-[60px] text-xl"
                  disabled={busy || !canAdd}
                  onClick={() =>
                    run(`Bottle ${ml} ml saved.`, async () => {
                      const saved = await start(feedType, { method: "Bottle", milk, amount_ml: ml }, nowIso);
                      // The fridge count is best effort: it is skipped while the feed waits on the phone.
                      if (saved.status === "saved" && !/formula/i.test(milk)) {
                        const r = await rpc("milk_consume", { p_ml: ml, p_note: null });
                        const short = Number((r as { short_ml?: number }).short_ml ?? 0);
                        if (short > 0) setMsg(`Bottle ${ml} ml saved. The fridge was ${short} ml short.`);
                      }
                    })
                  }
                >
                  {ml} ml
                </button>
              ))}
            </div>
          </div>
        </Sheet>
      )}
      {sheet === "diaper" && (
        <Sheet title="Nappy" onClose={closeSheet} when={when} onWhen={setWhen} timezone={timezone} busy={busy}>
          <div className="grid grid-cols-3 gap-2">
            {(diaperType?.fields.find((f) => f.key === "kind")?.options ?? ["Wet", "Dirty", "Both"]).map((k) => (
              <button key={k} type="button" className="action action-col tint-diaper items-center text-center" disabled={busy || !canAdd} onClick={() => run(`Nappy (${k.toLowerCase()}) saved.`, () => start(diaperType, { kind: k }, nowIso))}>
                <span className="icon-disc">
                  <Icon name="diaper" size={22} />
                </span>
                <span className="action-label">{k}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === "pump" && pumpType && (
        <Sheet title="Pump, to the fridge" onClose={closeSheet} when={when} onWhen={setWhen} timezone={timezone} busy={busy}>
          <div className="grid grid-cols-4 gap-2">
            {[90, 120, 150, 180].map((ml) => (
              <button
                key={ml}
                type="button"
                className="chip min-h-[60px] text-xl"
                disabled={busy || !canAdd}
                onClick={() =>
                  run(`Pumped ${ml} ml, in the fridge.`, async () => {
                    const saved = await start(pumpType, { amount_ml: ml }, nowIso);
                    if (saved.status === "saved") await rpc("milk_add", { p_amount_ml: ml, p_location: "fridge", p_pumped_at: nowIso, p_note: null });
                  })
                }
              >
                {ml}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {!canAdd && <p className="muted text-sm">You can see {possessive(subject.name)} day but not log it.</p>}
    </section>
  );
}

/** A big tile: the feature's colour, the icon on a white disc, two or three words. */
function Tile({ tint, icon, label, sub, onClick, href, row = false, trailing, disabled }: { tint: string; icon: "zzz" | "sun" | "moon" | "bottle" | "diaper" | "droplet" | "clock"; label: string; sub?: string; onClick?: () => void; href?: string; row?: boolean; trailing?: string; disabled: boolean }) {
  const inner = (
    <>
      <span className="icon-disc">
        <Icon name={icon} size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="action-label">{label}</span>
        {sub && <span className="action-sub">{sub}</span>}
      </span>
      {trailing && <span className="chip text-base">{trailing}</span>}
    </>
  );
  const cls = `action ${row ? "" : "action-col"} tint-${tint}`;
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  );
}

/** The bottom sheet a tile opens: a title, the "when" chips, the amounts. Defined at
 *  module level so the clock tick does not remount it (and lose a half-picked time). */
function Sheet({ title, onClose, when, onWhen, timezone, busy, children }: { title: string; onClose: () => void; when: When; onWhen: (w: When) => void; timezone: string; busy: boolean; children: React.ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="flex items-center justify-between">
          <p className="action-label">{title}</p>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={22} />
          </button>
        </div>
        <WhenChips value={when} onChange={onWhen} timezone={timezone} disabled={busy} />
        {children}
      </div>
    </div>
  );
}
