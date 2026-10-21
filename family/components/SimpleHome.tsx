"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EntryRow, EntryType, HomeSummary, MilkData, OngoingEntry } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { endOrQueue, mergeOngoing, newClientId, onQueueChange, readQueueFor, sendOrQueue, type QueuedOp } from "@/lib/offline";
import { fmtTime } from "@/lib/time";
import { dirOf, fmtAgo, optionLabel, speechLang, t, type Lang } from "@/lib/i18n";
import { child, childName } from "@/lib/names";
import { Icon } from "@/components/Icon";
import { ListenButton } from "@/components/ListenButton";
import { awakeWindow } from "@/lib/child-insights";

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * The simple screen for a grandmother: what the child is doing, and four huge buttons.
 * Bottle (three amounts), Diaper (wet / dirty / both), Asleep or Woke up, Note (spoken or typed).
 * Every label in the member's language; Arabic reads right to left.
 */
export function SimpleHome({ summary, recent, milk }: { summary: HomeSummary; recent: EntryRow[]; milk: MilkData | null }) {
  const me = useMe();
  const router = useRouter();
  const lang = (me.member.lang ?? "en") as Lang;
  const vars = { child: childName(me, lang), sex: child(me)?.sex };
  const L = (k: Parameters<typeof t>[1]) => t(lang, k, vars);
  const { subject, types, ongoing: serverOngoing, timezone, last } = summary;
  // A sleep started with no signal is still on this phone; it counts as running.
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  useEffect(() => {
    const sb = supabaseBrowser();
    const load = () => void readQueueFor(sb).then(setQueue);
    load();
    return onQueueChange(load);
  }, []);
  const ongoing = mergeOngoing(serverOngoing, subject.id, queue, me.member.display_name, types);
  const [panel, setPanel] = useState<null | "bottle" | "diaper" | "note">(null);
  const [milkPick, setMilkPick] = useState<string | null>(null);
  // A pick lives as long as the bottle panel: Cancel, or a logged bottle, forgets it.
  useEffect(() => {
    if (panel !== "bottle") setMilkPick(null);
  }, [panel]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [, setTick] = useState(0);
  const recRef = useRef<Recognition | null>(null);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const canAdd = can(me, "lana", "add");
  const feedType = types.find((t) => t.key === "feed");
  const sleepType = types.find((t) => t.key === "sleep");
  const diaperType = types.find((t) => t.key === "diaper");
  const noteType = types.find((t) => t.key === "note");
  const bottleQuick = ((feedType?.fields.find((f) => f.key === "amount_ml")?.quick ?? [90, 120, 150]) as number[]).slice(0, 3);
  const openSleep = ongoing.find((e) => e.type_id === sleepType?.id);
  const openFeed = ongoing.find((e) => e.type_id === feedType?.id);
  const lastSleep = recent.find((e) => e.type_id === sleepType?.id && e.ended_at);
  // A quick bottle is the same milk as the last one (the full form does the same); none known, none claimed.
  const lastMilk = recent.find((e) => e.type_id === feedType?.id && e.payload.method === "Bottle" && typeof e.payload.milk === "string")?.payload.milk as string | undefined;
  // The milk in the bottle: the household's options, the last bottle's as the default, one tap to change.
  const milkField = feedType?.fields.find((f) => f.key === "milk") ?? null;
  const milkOptions = (milkField?.options ?? []) as string[];
  const milkChosen = milkPick ?? (lastMilk && milkOptions.includes(lastMilk) ? lastMilk : null);
  const lastFeed = last["lana.feed"];
  const lastDiaper = last["lana.diaper"];
  const now = Date.now();
  const minutesSince = (iso: string) => (now - new Date(iso).getTime()) / 60000;
  // Likely hungry (from how much the child took last time) and likely sleepy (awake window for the age).
  const hints: string[] = [];
  const due = lastFeed?.next_due ? Date.parse(lastFeed.next_due) : null;
  if (due != null) {
    const m = (due - now) / 60000;
    if (m <= 0 && m > -90) hints.push(L("hungryNow"));
    else if (m > 0 && m <= 30) hints.push(L("hungrySoon"));
  }
  if (!openSleep && lastSleep?.ended_at && subject.birth_date) {
    const awake = minutesSince(lastSleep.ended_at);
    const [lo, hi] = awakeWindow(Math.floor((now - Date.parse(subject.birth_date)) / 86_400_000));
    if (awake >= lo && awake <= 360) hints.push(L("sleepyNow"));
    else if (awake >= lo - 30 && awake < lo) hints.push(L("sleepySoon"));
    void hi;
  }
  const todayCount = (id: string | undefined) => (id ? (summary.today_counts[id] ?? 0) : 0);
  const todayText = `${L("todayText").replace("{feeds}", String(todayCount(feedType?.id))).replace("{diapers}", String(todayCount(diaperType?.id))).replace("{sleeps}", String(todayCount(sleepType?.id)))} ${openSleep ? L("asleepNow") : L("awakeNow")}`;

  async function log(type: EntryType | undefined, payload: Record<string, unknown>, ended: boolean, noteText: string | null = null) {
    if (!type) return;
    setBusy(true);
    setMsg(null);
    const nowIso = new Date().toISOString();
    const r = await sendOrQueue(supabaseBrowser(), { client_id: newClientId(), subject_id: subject.id, type_id: type.id, occurred_at: nowIso, ended_at: ended ? nowIso : null, payload, note: noteText });
    setBusy(false);
    if (r.status === "error") return setMsg(r.message);
    setMsg(r.status === "queued" ? L("savedOffline") : L("saved"));
    setPanel(null);
    setNote("");
    router.refresh();
  }
  async function endSleep(e: OngoingEntry) {
    setBusy(true);
    const r = await endOrQueue(supabaseBrowser(), e.id, new Date().toISOString());
    setBusy(false);
    if (r.status === "error") return setMsg(r.message);
    setMsg(r.status === "queued" ? L("savedOffline") : L("saved"));
    router.refresh();
  }
  function listen() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new Ctor();
    rec.lang = speechLang(lang);
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      setNote(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }

  const status = openFeed
    ? `${L("feeding")} · ${fmtAgo(lang, minutesSince(openFeed.occurred_at))}`
    : openSleep
      ? `${L("asleep")} ${fmtTime(openSleep.occurred_at, timezone)} · ${fmtAgo(lang, minutesSince(openSleep.occurred_at))}`
      : lastSleep?.ended_at
        ? `${L("awakeSince")} ${fmtTime(lastSleep.ended_at, timezone)}`
        : L("awake");

  const Big = ({ onClick, icon, label, tone = "" }: { onClick: () => void; icon: Parameters<typeof Icon>[0]["name"]; label: string; tone?: string }) => (
    <button type="button" className={`btn ${tone} flex-col gap-2`} style={{ minHeight: 120, fontSize: "1.35rem" }} onClick={onClick} disabled={busy || !canAdd}>
      <Icon name={icon} size={36} />
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4" dir={dirOf(lang)} lang={lang}>
      <header className="page-header page-header-large">
        <h1 className="page-title">{L("title")}</h1>
        <p className="text-xl">{status}</p>
        <p className="muted">
          {lastFeed ? `${L("lastFeed")}: ${fmtTime(lastFeed.occurred_at, timezone)} (${fmtAgo(lang, minutesSince(lastFeed.ended_at ?? lastFeed.occurred_at))})` : ""}
          {lastDiaper ? ` · ${L("lastDiaper")}: ${fmtTime(lastDiaper.occurred_at, timezone)}` : ""}
        </p>
        {milk && <p className="muted">{milk.fridge_ml} ml {L("milkInFridge")}</p>}
      </header>
      {msg && (
        <p role="status" className={`notice ${msg === L("saved") ? "notice-ok" : "notice-danger"} text-center text-lg font-semibold`}>
          {msg}
        </p>
      )}
      {panel === null && hints.length > 0 && (
        <div className="flex flex-col gap-2">
          {hints.map((h) => (
            <p key={h} className="notice notice-accent text-center text-xl font-bold">
              {h}
            </p>
          ))}
        </div>
      )}
      {panel === null && <ListenButton text={todayText} lang={lang} label={L("listen")} />}
      {panel === null && (
        <div className="grid grid-cols-2 gap-3">
          <Big icon="bottle" label={L("bottle")} tone="btn-primary" onClick={() => setPanel("bottle")} />
          <Big icon="diaper" label={L("diaper")} onClick={() => setPanel("diaper")} />
          {openSleep ? <Big icon="sun" label={L("wokeUp")} onClick={() => endSleep(openSleep)} /> : <Big icon="zzz" label={L("fellAsleep")} onClick={() => log(sleepType, {}, false)} />}
          <Big icon="note" label={L("note")} onClick={() => setPanel("note")} />
          {can(me, "assistant", "view") && (
            <Link href="/ask" className="btn flex-col gap-2" style={{ minHeight: 120, fontSize: "1.35rem" }}>
              <Icon name="mic" size={36} />
              {L("ask")}
            </Link>
          )}
        </div>
      )}
      {panel === "bottle" && (
        <div className="grid grid-cols-3 gap-3">
          {milkOptions.length > 0 && (
            <div className="col-span-3 flex flex-col gap-2" role="radiogroup" aria-label={L("whichMilk")}>
              <p className="muted text-center text-lg font-semibold">{L("whichMilk")}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {milkOptions.map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={milkChosen === m} className={`btn ${milkChosen === m ? "btn-primary" : ""}`} style={{ minHeight: 56, fontSize: "1.15rem" }} onClick={() => setMilkPick(m)}>
                    {optionLabel(lang, m, milkField)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {bottleQuick.map((ml) => (
            <button key={ml} type="button" className="btn btn-primary" style={{ minHeight: 110, fontSize: "1.5rem" }} disabled={busy} onClick={() => log(feedType, { method: "Bottle", ...(milkChosen ? { milk: milkChosen } : {}), amount_ml: ml }, true)}>
              {ml} ml
            </button>
          ))}
          <button type="button" className="btn col-span-3" onClick={() => setPanel(null)}>
            {L("cancel")}
          </button>
        </div>
      )}
      {panel === "diaper" && (
        <div className="grid grid-cols-3 gap-3">
          {(["Wet", "Dirty", "Both"] as const).map((k) => (
            <button key={k} type="button" className="btn btn-primary" style={{ minHeight: 110, fontSize: "1.3rem" }} disabled={busy} onClick={() => log(diaperType, { kind: k }, true)}>
              {L(k.toLowerCase() as "wet" | "dirty" | "both")}
            </button>
          ))}
          <button type="button" className="btn col-span-3" onClick={() => setPanel(null)}>
            {L("cancel")}
          </button>
        </div>
      )}
      {panel === "note" && (
        <form
          className="card flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) void log(noteType, {}, true, note.trim());
          }}
        >
          <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={listening ? L("listening") : L("noteHint")} style={{ fontSize: "1.2rem" }} />
          <div className="grid grid-cols-3 gap-2">
            {recognitionCtor() && (
              <button type="button" className={`btn ${listening ? "mic-on" : ""}`} onClick={listen}>
                <Icon name="mic" size={22} /> {L("speak")}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setPanel(null)}>
              {L("cancel")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !note.trim()}>
              {L("save")}
            </button>
          </div>
        </form>
      )}
      <FullScreenLink label={L("fullScreen")} />
    </div>
  );
}

function FullScreenLink({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn-ghost text-sm"
      onClick={async () => {
        await supabaseBrowser().rpc("me_prefs_save", { p_simple_mode: false });
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
