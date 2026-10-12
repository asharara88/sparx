"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EntryRow, EntryType, OngoingEntry, Subject } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { can } from "@/lib/types";
import { fmtDuration, fmtTime, minutesBetween } from "@/lib/time";
import { supabaseBrowser } from "@/lib/supabase/client";
import { newClientId } from "@/lib/offline";
import { Boobs } from "./Boobs";
import { Icon } from "@/components/Icon";

/**
 * Lana's screen follows her state: asleep, awake, feeding, awake at night.
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
  ongoing,
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
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const canAdd = can(me, "lana", "add");
  const flags = me.member as unknown as Record<string, boolean>;
  const feedType = types.find((t) => t.key === "feed");
  const sleepType = types.find((t) => t.key === "sleep");
  const wakeType = types.find((t) => t.key === "wake");
  const diaperType = types.find((t) => t.key === "diaper");
  const breastfeeds = !!feedType?.settings?.timer_flag && !!flags[feedType.settings.timer_flag!];
  const bottleQuick = (feedType?.fields.find((f) => f.key === "amount_ml")?.quick ?? [60, 90, 120, 150]) as number[];
  const milkOptions = (feedType?.fields.find((f) => f.key === "milk")?.options ?? []) as string[];
  const now = new Date();
  const nowIso = now.toISOString();

  // ---- what is Lana doing right now?
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

  const nightFrom = String(subject.settings.night_from ?? "19:00");
  const nightTo = String(subject.settings.night_to ?? "07:00");
  const hhmm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(now);
  const isNight = nightFrom > nightTo ? hhmm >= nightFrom || hhmm < nightTo : hhmm >= nightFrom && hhmm < nightTo;

  // ---- actions
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await supabaseBrowser().rpc(name, args);
    const res = data as { ok: boolean; message?: string; id?: string } | null;
    if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? "Could not save.");
    return res;
  }
  async function start(type: EntryType | undefined, payload: Record<string, unknown> = {}, endedAt: string | null = null) {
    if (!type) throw new Error("That kind of entry is switched off.");
    return rpc("care_entry_log", {
      p_subject_id: subject.id,
      p_type_id: type.id,
      p_occurred_at: nowIso,
      p_ended_at: endedAt,
      p_payload: payload,
      p_note: null,
      p_client_id: newClientId(),
    });
  }
  async function end(entry: OngoingEntry) {
    return rpc("care_entry_end", { p_id: entry.id, p_ended_at: new Date().toISOString() });
  }
  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(label);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const sinceText = (iso: string) => `${fmtTime(iso, timezone)} · ${fmtDuration(Math.max(0, minutesBetween(iso, nowIso)))}`;

  // ---- status line
  let status: React.ReactNode;
  let tone = "";
  if (state.kind === "asleep") {
    status = (
      <>
        <Icon name="zzz" size={18} className="inline" /> Asleep since {sinceText(state.entry.occurred_at)}
      </>
    );
    tone = "notice-accent";
  } else if (state.kind === "feeding") {
    status = (
      <>
        <Icon name="bottle" size={18} className="inline" /> Feeding{state.side ? `, ${state.side.toLowerCase()}` : ""} · {sinceText(state.entry.occurred_at)}
      </>
    );
    tone = "notice-ok";
  } else if (state.kind === "night_awake") {
    status = (
      <>
        <Icon name="moon" size={18} className="inline" /> Awake in the night since {sinceText(state.entry.occurred_at)}
      </>
    );
    tone = "notice-warn";
  } else {
    status = (
      <>
        <Icon name="sun" size={18} className="inline" /> Awake{state.since ? ` since ${sinceText(state.since)}` : ""}
      </>
    );
  }

  const Big = ({ onClick, children, primary = true }: { onClick: () => void; children: React.ReactNode; primary?: boolean }) => (
    <button className={`btn ${primary ? "btn-primary" : ""} min-h-[72px] text-xl`} onClick={onClick} disabled={busy || !canAdd}>
      {children}
    </button>
  );

  return (
    <section className="flex flex-col gap-3" aria-live="polite">
      <div className={`notice ${tone}`}>
        <p className="text-xl font-bold">{status}</p>
        {state.kind === "feeding" && !breastfeeds && (
          <p className="mt-1 text-4xl font-bold tabular-nums">{fmtDuration(Math.max(0, minutesBetween(state.entry.occurred_at, nowIso)))}</p>
        )}
      </div>

      {msg && (
        <p role="status" className="muted text-sm">
          {msg}
        </p>
      )}

      {/* ---- feeding: switch side or finish */}
      {state.kind === "feeding" && (
        <>
          {breastfeeds && (
            <Boobs
              active={state.side === "Left" || state.side === "Right" ? state.side : null}
              elapsed={fmtDuration(Math.max(0, minutesBetween(state.entry.occurred_at, nowIso)))}
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
          <Big onClick={() => run("Feed saved.", () => end(state.entry))}>Done feeding</Big>
        </>
      )}

      {/* ---- asleep: wake up (night wake if it is night) */}
      {state.kind === "asleep" && (
        <div className="grid grid-cols-1 gap-3">
          <Big
            onClick={() =>
              run(isNight ? "Night wake-up started." : "Good morning, Lana.", async () => {
                await end(state.entry);
                if (isNight && wakeType) await start(wakeType, {});
              })
            }
          >
            <Icon name={isNight ? "moon" : "sun"} size={20} /> {isNight ? "Woke up (night)" : "Woke up"}
          </Big>
          {isNight && (
            <Big
              primary={false}
              onClick={() =>
                run("Up for the day.", async () => {
                  await end(state.entry);
                })
              }
            >
              <Icon name="sun" size={20} /> Up for the day
            </Big>
          )}
        </div>
      )}

      {/* ---- awake (day or night): feed, diaper, sleep */}
      {(state.kind === "awake" || state.kind === "night_awake") && (
        <>
          {breastfeeds && (
            <Boobs
              active={null}
              elapsed={null}
              suggested={suggestedSide}
              counts={sideCounts}
              disabled={busy || !canAdd}
              onTap={(s) => run(`${s} boob started.`, () => start(feedType, { method: "Breast", side: s }))}
            />
          )}
          <div className="card">
            <p className="font-semibold">
              <Icon name="bottle" size={20} /> Bottle
            </p>
            {milkOptions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Which milk">
                {milkOptions.map((m) => (
                  <button key={m} type="button" className="chip" aria-pressed={milk === m} onClick={() => setMilk(m)} disabled={busy}>
                    {m}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {bottleQuick.map((ml) => (
                <button
                  key={ml}
                  type="button"
                  className="chip min-h-[56px] text-lg"
                  disabled={busy || !canAdd}
                  onClick={() => run(`Bottle ${ml} ml saved.`, () => start(feedType, { method: "Bottle", milk, amount_ml: ml }, nowIso))}
                >
                  {ml} ml
                </button>
              ))}
            </div>
          </div>
          <div className="card">
            <p className="font-semibold">
              <Icon name="diaper" size={20} /> Diaper
            </p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(diaperType?.fields.find((f) => f.key === "kind")?.options ?? ["Wet", "Dirty", "Both"]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="chip min-h-[56px] text-lg"
                  disabled={busy || !canAdd}
                  onClick={() => run(`Diaper (${k.toLowerCase()}) saved.`, () => start(diaperType, { kind: k }, nowIso))}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          <Big
            onClick={() =>
              run("Sleep started.", async () => {
                if (state.kind === "night_awake") await end(state.entry);
                await start(sleepType, {});
              })
            }
          >
            <Icon name="zzz" size={20} /> {state.kind === "night_awake" ? "Back to sleep" : "Fell asleep"}
          </Big>
        </>
      )}

      {!canAdd && <p className="muted text-sm">You can see Lana's day but not log it.</p>}
    </section>
  );
}
