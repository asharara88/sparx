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
import { Sheet as BaseSheet } from "./Sheet";
import { Icon, type IconName } from "@/components/Icon";
import { WhenChips } from "@/components/WhenChips";
import { NOW, type When, whenToIso, isEarlier, recallWhen } from "@/lib/when";
import { fromLocalInput, toLocalInput } from "@/lib/time";
import { bottleChoices, napLengths, overlappingSleep } from "@/lib/backlog";
import { possessive } from "@/lib/names";
import { isNightAt } from "@/lib/night";

/**
 * Home's log (DESIGN.md, "Home"): one row per activity, Huckleberry-style. Each row says
 * when it last happened; the round button on the right is the one-tap action (start a
 * sleep, stop a feed or a sleep, open the amounts), and tapping the row opens its sheet
 * with a big button for now and the times for something that already happened. Timers
 * are open entries (no end time yet).
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
  lastFeedMethod,
}: {
  subject: Subject;
  types: EntryType[];
  ongoing: OngoingEntry[];
  recent: EntryRow[];
  timezone: string;
  lastMilk: string | null;
  /** How the last feed went ("Bottle", "Breast"), however long ago: the Feed sheet opens on it. */
  lastFeedMethod: string | null;
}) {
  const me = useMe();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [milk, setMilk] = useState<string>(lastMilk ?? "Morning pumped");
  // "When": now by default; a clock time when the tap comes late. Every tap in a sheet honours it.
  const [when, setWhen] = useState<When>(NOW);
  // The sheet a tile opened (feed, nappy, pump, or a sleep from earlier); closes when the tap saves.
  const [sheet, setSheet] = useState<"feed" | "diaper" | "pump" | "sleep" | null>(null);
  // The time last used for an entry from earlier: the next sheet opened within a minute
  // starts on it (a bottle and a nappy from the same moment). One-tap tiles never use it.
  const lastEarlier = useRef<{ when: When; at: number } | null>(null);
  // A sleep from earlier that lands on one already logged, waiting for "Log anyway".
  const [clash, setClash] = useState<{ entry: EntryRow; lastedMin: number | null } | null>(null);
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
  // The last bottle's amount is the usual one: marked on the sheet, and always a chip.
  const bottle = bottleChoices((feedType?.fields.find((f) => f.key === "amount_ml")?.quick ?? [60, 90, 120, 150]) as number[], Number(recent.find((e) => e.type_id === feedType?.id && e.payload.method === "Bottle")?.payload.amount_ml) || null);
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
  // The Sleep row's own state: a feed can run while she sleeps (or during a night wake), and
  // the row must still end the sleep, so it does not go through the combined state above.
  const sleepEntry = openSleep ?? null;
  const nightWake = openSleep ? null : (openWake ?? null);

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
  async function run(label: string, fn: () => Promise<unknown>, sayTime = true) {
    setBusy(true);
    setMsg(null);
    queuedRef.current = false;
    try {
      await fn();
      const base = isEarlier(when) && sayTime ? `${label.replace(/\.$/, "")}, as of ${fmtTime(whenIso, timezone)}.` : label;
      setMsg(queuedRef.current ? `${base} Saved on this phone; it will send when back online.` : base);
      if (isEarlier(when)) lastEarlier.current = { when: { kind: "at", local: toLocalInput(whenIso, timezone) }, at: Date.now() };
      setWhen(NOW);
      setSheet(null);
      setClash(null);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const realNowIso = now.toISOString();

  const elapsed = (iso: string) => fmtDuration(Math.max(0, minutesBetween(iso, realNowIso)));
  // Each tile says when it last happened ("1 h 50 min ago"); a day or more is the tile's
  // plain hint instead, and a log gap of 12 hours never reads as "awake 20 h".
  const ago = (typeId: string | undefined, fallback: string) => {
    const last = typeId ? recent.find((e) => e.type_id === typeId) : undefined;
    if (!last) return fallback;
    const m = minutesBetween(last.ended_at ?? last.occurred_at, realNowIso);
    return m >= 0 && m < 24 * 60 ? `${fmtDuration(m)} ago` : fallback;
  };
  // Which half of the Feed sheet shows: the way the last feed went, bottle or breast.
  const [feedTab, setFeedTab] = useState<"breast" | "bottle">(() => (breastfeeds && lastFeedMethod !== "Bottle" ? "breast" : "bottle"));

  // A sheet opens on now, or on the time from earlier used under a minute ago.
  const openSheet = (k: NonNullable<typeof sheet>) => {
    setWhen(recallWhen(lastEarlier.current, Date.now()));
    setClash(null);
    setSheet(k);
  };
  // Closing a sheet without saving drops a "when" picked inside it, so the next one-tap
  // tile (Asleep) is never quietly backdated.
  const closeSheet = () => {
    setWhen(NOW);
    setSheet(null);
    setClash(null);
  };
  const off = busy || !canAdd;
  const startSleep = () =>
    run("Sleep started.", async () => {
      if (nightWake) await end(nightWake);
      await start(sleepType, {});
    });
  // A night wake or the morning by the time she woke (a wake from earlier can fall either side).
  const wake = (entry: OngoingEntry) => {
    const nightWake = isNightAt(new Date(whenIso), timezone, subject.settings);
    return run(nightWake ? "Night wake-up started." : `Good morning, ${subject.name}.`, async () => {
      await end(entry);
      if (nightWake && wakeType) await start(wakeType, {});
    });
  };
  // A sleep from earlier: from the picked time, either still going or for `lastedMin`.
  // One already logged in that span is shown first, with the way to change it.
  const logSleep = (lastedMin: number | null, anyway = false) => {
    const from = Date.parse(whenIso);
    const to = lastedMin == null ? now.getTime() : from + lastedMin * 60_000;
    const other = anyway ? null : overlappingSleep(recent, from, to, now.getTime(), sleepType?.id);
    if (other) return setClash({ entry: other, lastedMin });
    const endIso = lastedMin == null ? null : new Date(to).toISOString();
    return run(
      endIso ? `Sleep ${fmtTime(whenIso, timezone)} to ${fmtTime(endIso, timezone)} saved.` : `Asleep since ${fmtTime(whenIso, timezone)}.`,
      async () => {
        // Back to sleep after a night wake ends the wake; a nap that ended before the wake
        // began leaves it alone. Still asleep since before the wake makes no sense.
        if (nightWake) {
          const wokeAt = Date.parse(nightWake.occurred_at);
          if (from >= wokeAt) await end(nightWake);
          else if (endIso == null || to > wokeAt) throw new Error(`She was awake from ${fmtTime(nightWake.occurred_at, timezone)}. Pick a time after that.`);
        }
        await start(sleepType, {}, endIso);
      },
      false,
    );
  };
  const finishFeed = (entry: OngoingEntry) => run("Feed saved.", () => end(entry));
  const switchSide = (entry: OngoingEntry, side: "Left" | "Right") =>
    run(`Switched to ${side.toLowerCase()} boob.`, async () => {
      await end(entry);
      await start(feedType, { method: "Breast", side });
    });

  // What each row says: when it last happened and one detail, or what is running now.
  const lastOf = (typeId: string | undefined) => (typeId ? recent.find((e) => e.type_id === typeId) : undefined);
  const lastFeed = lastOf(feedType?.id);
  const feedSub =
    state.kind === "feeding"
      ? `Feeding${state.side ? `, ${state.side.toLowerCase()}` : ""} · ${elapsed(state.entry.occurred_at)}`
      : lastFeed && ago(feedType?.id, "") !== ""
        ? `${ago(feedType?.id, "")} · ${lastFeed.payload.method === "Bottle" ? (lastFeed.payload.amount_ml ? `${lastFeed.payload.amount_ml} ml` : "bottle") : lastFeed.payload.side ? String(lastFeed.payload.side).toLowerCase() : "breast"}`
        : breastfeeds ? "Breast or bottle" : "Bottle";
  const napLen = lastSleep?.ended_at ? Math.round((Date.parse(lastSleep.ended_at) - Date.parse(lastSleep.occurred_at)) / 60_000) : 0;
  const sleepSub =
    sleepEntry ? `Asleep · since ${fmtTime(sleepEntry.occurred_at, timezone)}`
    : nightWake ? `Awake since ${fmtTime(nightWake.occurred_at, timezone)}`
    : lastSleep?.ended_at && minutesBetween(lastSleep.ended_at, realNowIso) <= 12 * 60 && napLen > 0 ? `Last sleep ${fmtDuration(napLen)}`
    : "Tap when she falls asleep";
  const lastNappy = lastOf(diaperType?.id);
  const nappySub = lastNappy && ago(diaperType?.id, "") !== "" ? `${ago(diaperType?.id, "")}${lastNappy.payload.kind ? ` · ${String(lastNappy.payload.kind).toLowerCase()}` : ""}` : "Wet or dirty";
  const lastPump = lastOf(pumpType?.id);
  const pumpSub = lastPump && ago(pumpType?.id, "") !== "" ? `${ago(pumpType?.id, "")}${lastPump.payload.amount_ml ? ` · ${lastPump.payload.amount_ml} ml` : ""}` : "To the fridge";
  const feedEntry = state.kind === "feeding" ? state.entry : null;
  const feedSide = state.kind === "feeding" && (state.side === "Left" || state.side === "Right") ? state.side : null;

  return (
    <section className="flex flex-col gap-3" aria-live="polite">
      {msg && (
        <p role="status" className="notice notice-ok text-sm">
          {msg}
        </p>
      )}

      <ul className="card flex flex-col p-0" aria-label="Log">
        <Row tint="feed" icon="bottle" label="Feed" sub={feedSub} live={!!feedEntry} disabled={off} onOpen={() => openSheet("feed")}
          action={feedEntry ? { kind: "stop", label: "Done feeding", onClick: () => finishFeed(feedEntry) } : { kind: "play", label: "Start a feed", onClick: () => openSheet("feed") }} />
        <Row tint="sleep" icon="zzz" label="Sleep" sub={sleepSub} live={!!sleepEntry} disabled={off} onOpen={() => openSheet("sleep")}
          action={sleepEntry ? { kind: "stop", label: "Woke up", onClick: () => wake(sleepEntry) } : { kind: "play", label: nightWake ? "Back to sleep" : "Asleep now", onClick: startSleep }} />
        <Row tint="diaper" icon="diaper" label="Nappy" sub={nappySub} disabled={off} onOpen={() => openSheet("diaper")} action={{ kind: "plus", label: "Log a nappy", onClick: () => openSheet("diaper") }} />
        {breastfeeds && pumpType ? (
          <Row tint="pump" icon="droplet" label="Pump" sub={pumpSub} disabled={off} onOpen={() => openSheet("pump")} action={{ kind: "plus", label: "Log a pump", onClick: () => openSheet("pump") }} />
        ) : (
          <Row tint="meds" icon="clock" label="Medicine" sub="Log a dose" disabled={off} href="/baby/medicine" action={{ kind: "plus", label: "Log a dose", href: "/baby/medicine" }} />
        )}
      </ul>

      {sheet === "feed" && (
        <Sheet title="Feed" onClose={closeSheet} when={when} onWhen={setWhen} timezone={timezone} busy={busy}>
          {breastfeeds && (
            <div className="segmented" role="group" aria-label="Breast or bottle">
              {(["breast", "bottle"] as const).map((t) => (
                <button key={t} type="button" aria-pressed={feedTab === t} onClick={() => setFeedTab(t)}>
                  {t === "breast" ? "Breast" : "Bottle"}
                </button>
              ))}
            </div>
          )}
          {breastfeeds && feedTab === "breast" && (
            <>
              <Boobs
                active={feedSide}
                elapsed={feedEntry ? elapsed(feedEntry.occurred_at) : null}
                suggested={feedEntry ? null : suggestedSide}
                counts={sideCounts}
                disabled={off}
                onTap={(s) => (feedEntry ? (s === feedSide ? finishFeed(feedEntry) : switchSide(feedEntry, s)) : run(`${s} boob started.`, () => start(feedType, { method: "Breast", side: s })))}
              />
              {feedEntry && minutesBetween(feedEntry.occurred_at, realNowIso) >= 30 && (
                <p className="notice notice-warn text-center text-sm font-semibold" role="status">
                  Over 30 min on one side. Timer left on? Tap the boob to stop it.
                </p>
              )}
              {feedEntry && (
                <button type="button" className="btn btn-primary btn-lg" onClick={() => finishFeed(feedEntry)} disabled={off}>
                  <Icon name="check" size={20} /> Done feeding
                </button>
              )}
            </>
          )}
          {(!breastfeeds || feedTab === "bottle") && (
            <div className="flex flex-col gap-2">
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
                {bottle.amounts.map((ml) => (
                  <button
                    key={ml}
                    type="button"
                    className="chip min-h-[60px] text-xl"
                    aria-pressed={ml === bottle.usual}
                    disabled={off}
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
          )}
        </Sheet>
      )}
      {sheet === "diaper" && (
        <Sheet title="Nappy" onClose={closeSheet} when={when} onWhen={setWhen} timezone={timezone} busy={busy}>
          <div className="grid grid-cols-3 gap-2">
            {(diaperType?.fields.find((f) => f.key === "kind")?.options ?? ["Wet", "Dirty", "Both"]).map((k) => (
              <button key={k} type="button" className="action action-col tint-diaper items-center text-center" disabled={off} onClick={() => run(`Nappy (${k.toLowerCase()}) saved.`, () => start(diaperType, { kind: k }, nowIso))}>
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
                disabled={off}
                onClick={() =>
                  run(`Pumped ${ml} ml, in the fridge.`, async () => {
                    const saved = await start(pumpType, { amount_ml: ml }, nowIso);
                    if (saved.status === "saved") await rpc("milk_add", { p_amount_ml: ml, p_location: "fridge", p_pumped_at: nowIso, p_note: null });
                  })
                }
              >
                {ml} ml
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === "sleep" && (
        <BaseSheet title="Sleep" onClose={closeSheet}>
          {/* Now: one big button. Earlier: the time she fell asleep (or woke), then when she woke. */}
          {!isEarlier(when) && (
            <div className="flex flex-col items-center gap-2 py-1">
              <button type="button" className="big-timer tint-sleep" disabled={off} onClick={() => (sleepEntry ? wake(sleepEntry) : startSleep())}>
                <Icon name={sleepEntry ? "sun" : "zzz"} size={30} />
                <span>{sleepEntry ? "Woke up now" : nightWake ? "Back to sleep" : "Asleep now"}</span>
                {sleepEntry && <span className="big-timer-sub">asleep {elapsed(sleepEntry.occurred_at)}</span>}
              </button>
              {sleepEntry && isNight && (
                <button type="button" className="btn" disabled={off} onClick={() => run("Up for the day.", () => end(sleepEntry))}>
                  <Icon name="sun" size={18} /> Up for the day
                </button>
              )}
            </div>
          )}
          <p className="divider-label">{isEarlier(when) ? "It already happened" : "or it already happened"}</p>
          <WhenChips label={sleepEntry ? "Woke up" : "Fell asleep"} value={when} onChange={(w) => { setWhen(w); setClash(null); }} timezone={timezone} disabled={busy} defaultOpen />
          {isEarlier(when) &&
            (sleepEntry ? (
              <button type="button" className="btn btn-primary btn-lg" disabled={off} onClick={() => wake(sleepEntry)}>
                Woke up at {fmtTime(whenIso, timezone)}
              </button>
            ) : clash ? (
              <div className="notice notice-warn flex flex-col gap-2" role="alert">
                <p className="font-semibold">
                  On top of a sleep from {fmtTime(clash.entry.occurred_at, timezone)}
                  {clash.entry.ended_at ? ` to ${fmtTime(clash.entry.ended_at, timezone)}` : ", still going"}.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Link href={`/baby/entry/${clash.entry.id}`} className="btn">
                    Change it
                  </Link>
                  <button type="button" className="btn" disabled={busy} onClick={() => logSleep(clash.lastedMin, true)}>
                    Log anyway
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="font-semibold">Woke up</p>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Woke up">
                  <button type="button" className="chip col-span-3 min-h-[52px]" disabled={off} onClick={() => logSleep(null)}>
                    Still asleep
                  </button>
                  {napLengths(Date.parse(whenIso), now.getTime()).map((m) => {
                    const at = fmtTime(new Date(Date.parse(whenIso) + m * 60_000).toISOString(), timezone);
                    return (
                      <button key={m} type="button" className="chip min-h-[56px] flex-col gap-0 leading-tight" disabled={off} onClick={() => logSleep(m)} aria-label={`Woke at ${at}, ${fmtDuration(m)}`}>
                        <span className="font-semibold tabular-nums">{at}</span>
                        <span className="text-sm opacity-80">{fmtDuration(m)}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ))}
        </BaseSheet>
      )}

      {!canAdd && <p className="muted text-sm">You can see {possessive(subject.name)} day but not log it.</p>}
    </section>
  );
}

type RowAction = { kind: "play" | "stop" | "plus"; label: string; onClick?: () => void; href?: string };

/**
 * One activity on Home: the feature's icon, what and when it last happened, and a round
 * button on the right for the one-tap action. The row itself opens the activity's sheet.
 * The two are siblings, never one inside the other.
 */
function Row({ tint, icon, label, sub, live = false, disabled, onOpen, href, action }: { tint: string; icon: IconName; label: string; sub: string; live?: boolean; disabled: boolean; onOpen?: () => void; href?: string; action: RowAction }) {
  const body = (
    <>
      <span className={`icon-disc tint-${tint}`} style={{ width: 40, height: 40 }}>
        <Icon name={icon} size={21} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="action-label">{label}</span>
        <span className={`block truncate text-[0.95rem] ${live ? "font-semibold" : "muted"}`}>{sub}</span>
      </span>
    </>
  );
  const glyph =
    action.kind === "play" ? <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" />
    : action.kind === "stop" ? <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" />
    : <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" />;
  const btnCls = `round-go ${action.kind === "stop" ? "round-go-stop" : ""}`;
  const svg = (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      {glyph}
    </svg>
  );
  return (
    <li className="log-row">
      {href ? (
        <Link href={href} className="log-row-body">
          {body}
        </Link>
      ) : (
        <button type="button" className="log-row-body" onClick={onOpen} disabled={disabled}>
          {body}
        </button>
      )}
      {action.href ? (
        <Link href={action.href} className={btnCls} aria-label={action.label}>
          {svg}
        </Link>
      ) : (
        <button type="button" className={btnCls} aria-label={action.label} onClick={action.onClick} disabled={disabled}>
          {svg}
        </button>
      )}
    </li>
  );
}

/** The bottom sheet a row opens: the shared sheet with the "when" chips on top. Defined
 *  at module level so the clock tick does not remount it (and lose a half-picked time). */
function Sheet({ title, onClose, when, onWhen, timezone, busy, whenOpen = false, children }: { title: string; onClose: () => void; when: When; onWhen: (w: When) => void; timezone: string; busy: boolean; whenOpen?: boolean; children: React.ReactNode }) {
  return (
    <BaseSheet title={title} onClose={onClose}>
      <WhenChips value={when} onChange={onWhen} timezone={timezone} disabled={busy} defaultOpen={whenOpen} />
      {children}
    </BaseSheet>
  );
}
