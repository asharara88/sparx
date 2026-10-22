"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AssistantEvent, AssistantProposal, AssistantRef, AssistantReply, AssistantTurn, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { dateWords } from "@/lib/time";
import { supabaseBrowser } from "@/lib/supabase/client";
import { endOrQueue, newClientId, sendOrQueue } from "@/lib/offline";
import { Cited } from "./Cited";
import { Icon } from "@/components/Icon";
import { speechLang, spokenWhen, t, type Lang } from "@/lib/i18n";
import { recapOf } from "@/lib/assistant/memory";
import type { AskChat } from "@/lib/types";

/**
 * The Ask screen. Type or speak a question; the answer cites the log. If you ask
 * it to log something, it prepares a card and you tap Confirm — nothing is saved
 * until then. The conversation stays on this phone (session storage) only.
 */

interface Msg {
  role: "user" | "assistant";
  text: string;
  refs?: Record<string, AssistantRef>;
  proposals?: AssistantProposal[];
  /** The skills the answer drew on. */
  skills?: { id: string; title: string }[];
  error?: boolean;
  /** Still being written (streamed); not spoken, not saved yet. */
  streaming?: boolean;
  /** What it is doing while it works ("Reading the log…"). */
  status?: string;
  /** Saved with the chat: what happened to each proposal. */
  states?: Record<string, ProposalState>;
}
export type ChatSummary = Pick<AskChat, "id" | "title" | "updated_at">;

type ProposalState = { status: "pending" } | { status: "saving" } | { status: "saved"; href?: string; note: string } | { status: "dropped" } | { status: "error"; message: string };

/** This tab's unsaved chat, kept per member so a sign-in after someone else on the same phone starts clean. */
const storeKey = (memberId: string) => `family.ask.v1.${memberId}`;

// Browser speech recognition, minimal typing (not in lib.dom for every TS target).
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};
function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function Assistant({ suggestions, chats = [], initial = null, autoAsk = null, screen = null }: { suggestions: string[]; chats?: ChatSummary[]; initial?: AskChat | null; autoAsk?: string | null; screen?: string | null }) {
  const me = useMe();
  const router = useRouter();
  const STORE = storeKey(me.member.id);
  const lang = (me.member.lang ?? "en") as Lang;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [chatId, setChatId] = useState<string | null>(initial?.id ?? null);
  const [showChats, setShowChats] = useState(false);
  const [aloud, setAloud] = useState(false);
  const spokeRef = useRef(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [night, setNight] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [canTalk, setCanTalk] = useState(false);
  const [pstate, setPstate] = useState<Record<string, ProposalState>>({});
  const recRef = useRef<Recognition | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const heardRef = useRef("");
  // Talk mode: listen, ask, say the answer, listen again, until End.
  const [talk, setTalk] = useState(false);
  const talkRef = useRef(false);
  const silentRef = useRef(0);
  const startListeningRef = useRef<() => void>(() => {});
  // The request in flight, so End can stop it; and a listening session number, so a
  // recognition that was ended (or superseded) never sends what it half heard.
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef(0);
  const tz = me.household.timezone;

  /** Say it in the member's language; `then` runs when it has been said (or at once, with no voice). */
  function say(text: string, then?: () => void) {
    if (typeof speechSynthesis === "undefined" || !text.trim()) {
      then?.();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = speechLang(lang);
    u.onend = () => then?.();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
  /** What a proposal is, in words: the exact thing a tap would write, so a voice user hears it before confirming. */
  function spoken(p: AssistantProposal): string {
    if (p.kind === "care_entry" && p.care_entry) {
      const c = p.care_entry;
      const details = Object.entries(c.payload)
        .filter(([, v]) => v !== null && v !== "" && v !== undefined)
        .map(([k, v]) => (k === "amount_ml" ? `${v} ml` : k === "amount_g" ? `${v} g` : k === "duration_min" ? `${v} min` : String(v)))
        .join(", ");
      return `${c.type_label}${details ? `, ${details}` : ""}, ${c.subject_name}, ${spokenWhen(c.occurred_at, tz, lang)}${c.ended_at ? ` ${t(lang, "to")} ${spokenWhen(c.ended_at, tz, lang)}` : ""}.`;
    }
    if (p.kind === "end_timer" && p.end_timer) {
      const c = p.end_timer;
      return `${c.type_label} ${c.subject_name}, ${spokenWhen(c.since, tz, lang)} ${t(lang, "to")} ${spokenWhen(c.ended_at, tz, lang)}.`;
    }
    return p.summary.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").replace(/\s+·\s+/g, ", ").trim();
  }

  useEffect(() => {
    if (initial) {
      // a saved chat: rebuild the messages and what happened to each proposal
      const ms = (initial.messages as Msg[]).filter((m) => m && (m.role === "user" || m.role === "assistant"));
      setMsgs(ms);
      const st: Record<string, ProposalState> = {};
      for (const m of ms) for (const [k, v] of Object.entries(m.states ?? {})) st[k] = v.status === "saving" ? { status: "pending" } : v;
      setPstate(st);
    } else {
      try {
        const saved = JSON.parse(sessionStorage.getItem(STORE) ?? "null") as { msgs: Msg[]; pstate: Record<string, ProposalState>; chatId?: string | null } | null;
        if (saved?.msgs) {
          setMsgs(saved.msgs);
          setPstate(saved.pstate ?? {});
          setChatId(saved.chatId ?? null);
        }
      } catch {
        /* fresh start */
      }
    }
    setCanSpeak(!!recognitionCtor());
    setCanTalk(!!recognitionCtor() && typeof speechSynthesis !== "undefined");
    try {
      setNight(localStorage.getItem("family.ask.night") === "1");
      setAloud(localStorage.getItem("family.ask.aloud") === "1");
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id]);
  useEffect(() => {
    if (night) document.documentElement.setAttribute("data-theme", "night");
    else document.documentElement.removeAttribute("data-theme");
    return () => document.documentElement.removeAttribute("data-theme");
  }, [night]);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ msgs, pstate, chatId }));
    } catch {
      /* ignore */
    }
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, pstate, chatId]);

  // Save the thread (title = the first question) after every assistant reply and every proposal outcome.
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!msgs.some((m) => m.role === "assistant" && !m.error) || msgs.some((m) => m.streaming)) return;
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(async () => {
      const title = (msgs.find((m) => m.role === "user")?.text ?? "Chat").slice(0, 80);
      const payload = msgs.map((m) => (m.proposals?.length ? { ...m, states: Object.fromEntries(m.proposals.map((p) => [p.id, pstate[p.id] ?? { status: "pending" }])) } : m));
      const firstQ = msgs.find((m) => m.role === "user")?.text ?? "";
      const lastA = [...msgs].reverse().find((m) => m.role === "assistant" && !m.error)?.text ?? "";
      const { data } = await supabaseBrowser().rpc("ask_chat_save", { p_id: chatId, p_title: title, p_messages: payload, p_summary: firstQ && lastA ? recapOf(firstQ, lastA) : null });
      const res = data as { ok: boolean; id?: string } | null;
      if (res?.ok && res.id && res.id !== chatId) setChatId(res.id);
    }, 800);
    return () => {
      if (saveRef.current) clearTimeout(saveRef.current);
    };
  }, [msgs, pstate, chatId]);

  // Read the latest answer aloud, in the member's language, when switched on (always in talk mode).
  useEffect(() => {
    if ((!aloud && !talk) || typeof speechSynthesis === "undefined") return;
    const lastMsg = msgs[msgs.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant" || lastMsg.streaming || spokeRef.current) return;
    spokeRef.current = true;
    if (lastMsg.error) {
      if (talkRef.current) endTalk();
      return;
    }
    // The answer, then each proposal as the exact thing a tap would write.
    const text = [lastMsg.text.replace(/\[[a-z]+:[^\]]+\]/g, ""), ...(lastMsg.proposals ?? []).map(spoken)].join(" ");
    say(text, () => {
      // In talk mode the floor goes back to the member once the answer is said.
      if (talkRef.current && !lastMsg.proposals?.length) startListeningRef.current();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, aloud, talk, lang]);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      setInput("");
      setBusy(true);
      spokeRef.current = false;
      const turns: AssistantTurn[] = msgs.filter((m) => !m.error && !m.streaming).map((m) => ({ role: m.role, text: m.text }));
      // The answer is written into a streaming bubble as it arrives, then replaced by the final reply.
      setMsgs((m) => [...m, { role: "user", text: q }, { role: "assistant", text: "", streaming: true, status: "Thinking…" }]);
      const patch = (f: (last: Msg) => Msg) => setMsgs((m) => (m.length && m[m.length - 1].streaming ? [...m.slice(0, -1), f(m[m.length - 1])] : m));
      const finish = (msg: Msg) => setMsgs((m) => (m.length && m[m.length - 1].streaming ? [...m.slice(0, -1), msg] : [...m, msg]));
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, turns, screen, stream: true }), signal: controller.signal });
        if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) {
          const data = (await res.json().catch(() => null)) as AssistantReply | RpcError | null;
          if (data && data.ok) {
            finish({ role: "assistant", text: data.answer, refs: data.refs, proposals: data.proposals, skills: data.skills });
            if (data.proposals.length) setPstate((s) => ({ ...s, ...Object.fromEntries(data.proposals.map((p) => [p.id, { status: "pending" } as ProposalState])) }));
          } else finish({ role: "assistant", text: (data as RpcError | null)?.message ?? "Something went wrong.", error: true });
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let done = false;
        const handle = (e: AssistantEvent) => {
          if (e.type === "delta") patch((l) => ({ ...l, text: l.text + e.text, status: undefined }));
          else if (e.type === "reset") patch((l) => ({ ...l, text: "" }));
          else if (e.type === "status") patch((l) => ({ ...l, status: e.text }));
          else if (e.type === "done") {
            done = true;
            finish({ role: "assistant", text: e.reply.answer, refs: e.reply.refs, proposals: e.reply.proposals, skills: e.reply.skills });
            if (e.reply.proposals.length) setPstate((s) => ({ ...s, ...Object.fromEntries(e.reply.proposals.map((p) => [p.id, { status: "pending" } as ProposalState])) }));
          } else if (e.type === "error") {
            done = true;
            finish({ role: "assistant", text: e.message, error: true });
          }
        };
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
              handle(JSON.parse(line) as AssistantEvent);
            } catch {
              /* a torn line; the next one carries on */
            }
          }
        }
        if (!done) finish({ role: "assistant", text: "The answer was cut off. Ask again.", error: true });
      } catch {
        finish({ role: "assistant", text: controller.signal.aborted ? "Stopped." : "No connection. Try again when you are back online.", error: true });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, msgs, screen],
  );

  // Said on Home ("Say it to log"): send it straight away, once.
  const autoRef = useRef(false);
  useEffect(() => {
    if (!autoAsk || autoRef.current) return;
    autoRef.current = true;
    void ask(autoAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAsk]);

  // ---- voice
  function startListening() {
    if (recRef.current) return;
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    const session = ++sessionRef.current;
    rec.lang = speechLang(lang);
    rec.interimResults = true;
    rec.continuous = false;
    heardRef.current = "";
    rec.onresult = (e) => {
      if (session !== sessionRef.current) return;
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      heardRef.current = text;
      setInput(text);
    };
    rec.onerror = () => {
      if (session === sessionRef.current) setListening(false);
    };
    rec.onend = () => {
      if (session !== sessionRef.current) return; // ended by End, or superseded: say nothing, send nothing
      setListening(false);
      recRef.current = null;
      const heard = heardRef.current.trim();
      if (heard) {
        silentRef.current = 0;
        void ask(heard); // one-handed: speak, and it sends itself
      } else if (talkRef.current) {
        // Silence: listen again twice, then end the call rather than loop forever.
        silentRef.current += 1;
        if (silentRef.current <= 2) setTimeout(() => talkRef.current && startListening(), 400);
        else endTalk();
      }
    };
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      recRef.current = null;
    }
  }
  startListeningRef.current = startListening;
  function toggleListening() {
    if (listening) recRef.current?.stop();
    else startListening();
  }
  function startTalk() {
    talkRef.current = true;
    silentRef.current = 0;
    setTalk(true);
    startListening();
  }
  function endTalk() {
    talkRef.current = false;
    setTalk(false);
    sessionRef.current += 1; // whatever recognition is open belongs to no one now
    heardRef.current = "";
    recRef.current?.abort?.();
    recRef.current = null;
    setListening(false);
    abortRef.current?.abort(); // and the answer being fetched stops too
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  // ---- proposals: the one tap that writes
  async function confirm(p: AssistantProposal) {
    setPstate((s) => ({ ...s, [p.id]: { status: "saving" } }));
    const supabase = supabaseBrowser();
    // What is said (and shown) after the tap, in the member's language.
    const savedWord = `${t(lang, "saved")}.`;
    let result = savedWord;
    const saved = (href: string | undefined, note: string) => {
      result = note;
      setPstate((s) => ({ ...s, [p.id]: { status: "saved", href, note } }));
    };
    const offline = t(lang, "savedOffline");
    try {
      if (p.kind === "care_entry" && p.care_entry) {
        const c = p.care_entry;
        const r = await sendOrQueue(supabase, { client_id: newClientId(), subject_id: c.subject_id, type_id: c.type_id, occurred_at: c.occurred_at, ended_at: c.ended_at, payload: c.payload, note: c.note });
        if (r.status === "error") throw new Error(r.message);
        saved(r.status === "saved" ? `/entry/${r.id}` : undefined, r.status === "saved" ? savedWord : offline);
      } else if (p.kind === "end_timer" && p.end_timer) {
        const c = p.end_timer;
        const r = await endOrQueue(supabase, c.entry_id, c.ended_at);
        if (r.status === "error") throw new Error(r.message);
        saved(r.status === "saved" ? `/entry/${c.entry_id}` : undefined, r.status === "saved" ? t(lang, "ended") : offline);
      } else if (p.kind === "calendar_event" && p.calendar_event) {
        const c = p.calendar_event;
        const { data, error } = await supabase.rpc("calendar_save", { p_id: null, p_title: c.title, p_kind: c.kind, p_starts_at: c.starts_at, p_ends_at: c.ends_at, p_all_day: c.all_day, p_visibility: "household", p_assigned_to: null, p_note: c.note, p_repeat: "none", p_repeat_until: null });
        const res = data as { ok: boolean; message?: string } | null;
        if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? t(lang, "couldNotSave"));
        saved("/calendar", t(lang, "onCalendar"));
      } else if (p.kind === "plan" && p.plan) {
        const { data, error } = await supabase.rpc("coach_plan_start", { p_subject_id: p.plan.subject_id, p_goal: p.plan.goal, p_steps: p.plan.steps });
        const res = data as { ok: boolean; message?: string } | null;
        if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? "Could not start the plan.");
        saved("/", t(lang, "planStarted"));
      } else if (p.kind === "forget" && p.forget) {
        const { data, error } = await supabase.rpc("memory_remove", { p_id: p.forget.id });
        const res = data as { ok: boolean; message?: string } | null;
        if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? "Could not forget it.");
        saved("/ask/memory", t(lang, "forgotten"));
      } else if (p.kind === "memory" && p.memory) {
        const { data, error } = await supabase.rpc("memory_add", { p_body: p.memory.body });
        const res = data as { ok: boolean; message?: string } | null;
        if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? t(lang, "couldNotSave"));
        saved("/ask/memory", t(lang, "remembered"));
      } else {
        throw new Error("I do not know how to save that.");
      }
      // Out loud, the result; in talk mode the floor comes back once it is said.
      if (aloud || talkRef.current) say(result, () => talkRef.current && startListeningRef.current());
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : t(lang, "couldNotSave");
      setPstate((s) => ({ ...s, [p.id]: { status: "error", message } }));
      if (aloud || talkRef.current) say(message);
    }
  }

  function clear() {
    setMsgs([]);
    setPstate({});
    setChatId(null);
    setShowChats(false);
    try {
      sessionStorage.removeItem(STORE);
    } catch {
      /* ignore */
    }
    if (initial) router.push("/ask");
  }
  function toggleAloud() {
    const v = !aloud;
    setAloud(v);
    if (!v && typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    try {
      localStorage.setItem("family.ask.aloud", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  async function removeChat(id: string) {
    await supabaseBrowser().rpc("ask_chat_remove", { p_id: id });
    if (id === chatId) clear();
    router.refresh();
  }
  function toggleNight() {
    const v = !night;
    setNight(v);
    try {
      localStorage.setItem("family.ask.night", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  const writer = can(me, "assistant", "add");

  return (
    <div className="ask flex min-h-[calc(100dvh-9rem)] flex-col gap-3">
      <header className="page-header flex items-center justify-between gap-2">
        <h1 className="page-title">Ask</h1>
        <div className="flex gap-1">
          {canTalk && (
            <button type="button" className={`btn ${talk ? "btn-primary" : ""}`} style={{ minHeight: 40 }} onClick={talk ? endTalk : startTalk} aria-pressed={talk} aria-label={talk ? "End the call" : "Talk to the helper"} title="Hands-free: it listens, answers out loud, then listens again">
              <Icon name="phone" size={18} /> {talk ? "End" : "Talk"}
            </button>
          )}
          <button type="button" className="icon-btn m-0" onClick={toggleAloud} aria-pressed={aloud} aria-label="Read answers aloud" title="Read answers aloud">
            <Icon name="volume" size={22} className={aloud ? "text-[var(--accent)]" : "text-[var(--muted)]"} />
          </button>
          <button type="button" className="icon-btn m-0" onClick={toggleNight} aria-pressed={night} aria-label={night ? "Day screen" : "Night screen"} title="Dark screen for the night">
            <Icon name={night ? "sun" : "moon"} size={22} className="text-[var(--muted)]" />
          </button>
          <button type="button" className="icon-btn m-0" onClick={() => setShowChats((v) => !v)} aria-pressed={showChats} aria-label="Earlier chats" title="Earlier chats">
            <Icon name="history" size={22} className={showChats ? "text-[var(--accent)]" : "text-[var(--muted)]"} />
          </button>
          {msgs.length > 0 && (
            <button type="button" className="btn" style={{ minHeight: 40 }} onClick={clear}>
              New
            </button>
          )}
        </div>
      </header>
      {showChats && (
        <div className="card">
          <p className="section-title mb-1">Earlier chats</p>
          {chats.length === 0 ? (
            <p className="muted text-sm">Nothing saved yet. Chats save themselves after the first answer.</p>
          ) : (
            <ul className="flex flex-col">
              {chats.map((c) => (
                <li key={c.id} className="row">
                  <a href={`/ask?c=${c.id}`} className={`row-link min-w-0 grow ${c.id === chatId ? "font-semibold text-[var(--accent)]" : ""}`}>
                    <span className="block truncate">{c.title}</span>
                    <span className="muted block text-xs">{dateWords(new Date(c.updated_at), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: me.household.timezone })}</span>
                  </a>
                  <button type="button" className="icon-btn m-0 text-[var(--muted)]" aria-label="Remove chat" onClick={() => window.confirm("Remove this chat?") && removeChat(c.id)}>
                    <Icon name="x" size={18} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {msgs.length === 0 && (
        <div className="card">
          <p className="font-semibold">Ask anything about the house, in your own words.</p>
          <p className="muted mt-1 text-sm">Every answer links to the entry it came from. {writer ? "You can also say “log a 120 ml bottle” — it prepares it and you tap Confirm." : "This role can read, not write."}</p>
          {canTalk && <p className="muted mt-1 text-sm">Tap Talk for hands-free: it listens, answers out loud, then listens again. Say “remember that…” to teach it something.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => void ask(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <ol className="flex flex-1 flex-col gap-3" aria-live="polite">
        {msgs.map((m, i) => (
          <li key={i} className={m.role === "user" ? "self-end" : "self-start"} style={{ maxWidth: "92%" }}>
            <div className={m.role === "user" ? "bubble bubble-me" : `bubble ${m.error ? "bubble-err" : ""}`}>
              {m.role === "user" ? <p>{m.text}</p> : m.streaming && !m.text ? <p className="muted">{m.status ?? "Thinking…"}</p> : <Cited text={m.text} refs={m.refs} />}
              {m.streaming && m.text && <span className="muted"> ▍</span>}
            </div>
            {m.role === "assistant" && !m.streaming && !!m.skills?.length && (
              <p className="muted mt-1 px-1 text-xs" aria-label="Skills used">
                Used: {m.skills.map((k) => k.title).join(" · ")}
              </p>
            )}
            {m.proposals?.map((p) => {
              const st = pstate[p.id] ?? { status: "pending" };
              return (
                <div key={p.id} className="card mt-2 ring-2 ring-[var(--accent)]">
                  <p className="font-semibold">{p.summary}</p>
                  {p.plan && (
                    <ol className="mt-1 flex flex-col gap-1 text-sm">
                      {p.plan.steps.map((s) => (
                        <li key={s.day}>
                          <b>Day {s.day}.</b> {s.step}
                        </li>
                      ))}
                    </ol>
                  )}
                  {st.status === "pending" && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button type="button" className="btn" onClick={() => setPstate((s) => ({ ...s, [p.id]: { status: "dropped" } }))}>
                        {p.plan ? "Not now" : "Not this"}
                      </button>
                      <button type="button" className="btn btn-primary min-h-[64px] text-lg" onClick={() => void confirm(p)}>
                        {p.plan ? "Start this plan" : "Confirm"}
                      </button>
                    </div>
                  )}
                  {st.status === "saving" && <p className="muted mt-1">Saving…</p>}
                  {st.status === "saved" && (
                    <p className="mt-1 font-semibold text-[var(--ok)]">
                      {st.note}{" "}
                      {st.href && (
                        <a href={st.href} className="underline">
                          Open
                        </a>
                      )}
                    </p>
                  )}
                  {st.status === "dropped" && <p className="muted mt-1">Not saved.</p>}
                  {st.status === "error" && (
                    <p className="mt-1 text-[var(--danger)]" role="alert">
                      {st.message}{" "}
                      <button type="button" className="underline" onClick={() => void confirm(p)}>
                        Try again
                      </button>
                    </p>
                  )}
                </div>
              );
            })}
          </li>
        ))}
        <div ref={endRef} />
      </ol>

      <form
        className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] flex gap-2 bg-[var(--bg)] pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        {canSpeak && (
          <button type="button" className={`btn mic ${listening ? "mic-on" : ""}`} onClick={toggleListening} aria-pressed={listening} aria-label={listening ? "Stop listening" : "Speak"} disabled={busy}>
            {listening ? <span className="dot dot-danger" /> : <Icon name="mic" />}
          </button>
        )}
        <input className="input flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? (talk ? "Listening… say something, or tap End" : "Listening…") : talk && busy ? "Thinking…" : "Ask or tell me something"} aria-label="Your question" autoComplete="off" enterKeyHint="send" />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()} aria-label="Send">
          <Icon name="send" />
        </button>
      </form>
    </div>
  );
}
