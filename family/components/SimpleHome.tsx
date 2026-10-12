"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EntryRow, EntryType, HomeSummary, MilkData, OngoingEntry } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { newClientId } from "@/lib/offline";
import { fmtTime } from "@/lib/time";
import { dirOf, fmtAgo, speechLang, t, type Lang } from "@/lib/i18n";
import { Icon } from "@/components/Icon";

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * The simple screen for a grandmother: what Lana is doing, and four huge buttons.
 * Bottle (three amounts), Diaper (wet / dirty / both), Asleep or Woke up, Note (spoken or typed).
 * Every label in her language; Arabic reads right to left.
 */
export function SimpleHome({ summary, recent, milk, fantaFood }: { summary: HomeSummary; recent: EntryRow[]; milk: MilkData | null; fantaFood: { subjectId: string; typeId: string; food: string } | null }) {
  const me = useMe();
  const router = useRouter();
  const lang = (me.member.lang ?? "en") as Lang;
  const L = (k: Parameters<typeof t>[1]) => t(lang, k);
  const { subject, types, ongoing, timezone, last } = summary;
  const [panel, setPanel] = useState<null | "bottle" | "diaper" | "note">(null);
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
  const lastFeed = last["lana.feed"];
  const lastDiaper = last["lana.diaper"];
  const now = Date.now();
  const minutesSince = (iso: string) => (now - new Date(iso).getTime()) / 60000;

  async function log(type: EntryType | undefined, payload: Record<string, unknown>, ended: boolean, noteText: string | null = null) {
    if (!type) return;
    setBusy(true);
    setMsg(null);
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseBrowser().rpc("care_entry_log", { p_subject_id: subject.id, p_type_id: type.id, p_occurred_at: nowIso, p_ended_at: ended ? nowIso : null, p_payload: payload, p_note: noteText, p_client_id: newClientId() });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setMsg(L("saved"));
    setPanel(null);
    setNote("");
    router.refresh();
  }
  async function endSleep(e: OngoingEntry) {
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("care_entry_end", { p_id: e.id, p_ended_at: new Date().toISOString() });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setMsg(L("saved"));
    router.refresh();
  }
  async function fanta() {
    if (!fantaFood) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("care_entry_log", { p_subject_id: fantaFood.subjectId, p_type_id: fantaFood.typeId, p_occurred_at: new Date().toISOString(), p_ended_at: null, p_payload: { food: fantaFood.food }, p_note: null, p_client_id: newClientId() });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setMsg(L("saved"));
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
      {panel === null && (
        <div className="grid grid-cols-2 gap-3">
          <Big icon="bottle" label={L("bottle")} tone="btn-primary" onClick={() => setPanel("bottle")} />
          <Big icon="diaper" label={L("diaper")} onClick={() => setPanel("diaper")} />
          {openSleep ? <Big icon="sun" label={L("wokeUp")} onClick={() => endSleep(openSleep)} /> : <Big icon="zzz" label={L("fellAsleep")} onClick={() => log(sleepType, {}, false)} />}
          <Big icon="note" label={L("note")} onClick={() => setPanel("note")} />
          {fantaFood && can(me, "fanta", "add") && <Big icon="cat" label={L("fantaFed")} onClick={fanta} />}
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
          {bottleQuick.map((ml) => (
            <button key={ml} type="button" className="btn btn-primary" style={{ minHeight: 110, fontSize: "1.5rem" }} disabled={busy} onClick={() => log(feedType, { method: "Bottle", milk: "Morning pumped", amount_ml: ml }, true)}>
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
