"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AssistantProposal, AssistantRef, AssistantReply, AssistantTurn, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { newClientId, sendOrQueue } from "@/lib/offline";
import { Cited } from "./Cited";
import { Icon } from "@/components/Icon";
import { speechLang, type Lang } from "@/lib/i18n";
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
  error?: boolean;
  /** Saved with the chat: what happened to each proposal. */
  states?: Record<string, ProposalState>;
}
export type ChatSummary = Pick<AskChat, "id" | "title" | "updated_at">;

type ProposalState = { status: "pending" } | { status: "saving" } | { status: "saved"; href?: string; note: string } | { status: "dropped" } | { status: "error"; message: string };

const STORE = "family.ask.v1";

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

export function Assistant({ suggestions, chats = [], initial = null, autoAsk = null }: { suggestions: string[]; chats?: ChatSummary[]; initial?: AskChat | null; autoAsk?: string | null }) {
  const me = useMe();
  const router = useRouter();
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
    if (!msgs.some((m) => m.role === "assistant" && !m.error)) return;
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(async () => {
      const title = (msgs.find((m) => m.role === "user")?.text ?? "Chat").slice(0, 80);
      const payload = msgs.map((m) => (m.proposals?.length ? { ...m, states: Object.fromEntries(m.proposals.map((p) => [p.id, pstate[p.id] ?? { status: "pending" }])) } : m));
      const { data } = await supabaseBrowser().rpc("ask_chat_save", { p_id: chatId, p_title: title, p_messages: payload });
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
    if (!lastMsg || lastMsg.role !== "assistant" || spokeRef.current) return;
    spokeRef.current = true;
    if (lastMsg.error) {
      if (talkRef.current) endTalk();
      return;
    }
    const u = new SpeechSynthesisUtterance(lastMsg.text.replace(/\[[a-z]+:[^\]]+\]/g, ""));
    u.lang = speechLang(lang);
    u.onend = () => {
      // In talk mode the floor goes back to the member once the answer is said.
      if (talkRef.current && !lastMsg.proposals?.length) startListeningRef.current();
    };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, aloud, talk, lang]);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      setInput("");
      setBusy(true);
      spokeRef.current = false;
      const turns: AssistantTurn[] = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
      setMsgs((m) => [...m, { role: "user", text: q }]);
      try {
        const res = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, turns }) });
        const data = (await res.json()) as AssistantReply | RpcError;
        if (!data.ok) {
          setMsgs((m) => [...m, { role: "assistant", text: data.message ?? "Something went wrong.", error: true }]);
        } else {
          setMsgs((m) => [...m, { role: "assistant", text: data.answer, refs: data.refs, proposals: data.proposals }]);
          if (data.proposals.length) setPstate((s) => ({ ...s, ...Object.fromEntries(data.proposals.map((p) => [p.id, { status: "pending" } as ProposalState])) }));
        }
      } catch {
        setMsgs((m) => [...m, { role: "assistant", text: "No connection. Try again when you are back online.", error: true }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, msgs],
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
    rec.lang = speechLang(lang);
    rec.interimResults = true;
    rec.continuous = false;
    heardRef.current = "";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      heardRef.current = text;
      setInput(text);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
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
    recRef.current?.abort?.();
    recRef.current = null;
    setListening(false);
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  // ---- proposals: the one tap that writes
  async function confirm(p: AssistantProposal) {
    setPstate((s) => ({ ...s, [p.id]: { status: "saving" } }));
    const supabase = supabaseBrowser();
    try {
      if (p.kind === "care_entry" && p.care_entry) {
        const c = p.care_entry;
        const r = await sendOrQueue(supabase, { client_id: newClientId(), subject_id: c.subject_id, type_id: c.type_id, occurred_at: c.occurred_at, ended_at: c.ended_at, payload: c.payload, note: c.note });
        if (r.status === "error") throw new Error(r.message);
        setPstate((s) => ({ ...s, [p.id]: { status: "saved", href: r.status === "saved" ? `/entry/${r.id}` : undefined, note: r.status === "saved" ? "Saved." : "Saved on this phone; it will send when you are back online." } }));
      } else if (p.kind === "calendar_event" && p.calendar_event) {
        const c = p.calendar_event;
        const { data, error } = await supabase.rpc("calendar_save", { p_id: null, p_title: c.title, p_kind: c.kind, p_starts_at: c.starts_at, p_ends_at: c.ends_at, p_all_day: c.all_day, p_visibility: "household", p_assigned_to: null, p_note: c.note, p_repeat: "none", p_repeat_until: null });
        const res = data as { ok: boolean; message?: string } | null;
        if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? "Could not save.");
        setPstate((s) => ({ ...s, [p.id]: { status: "saved", href: "/calendar", note: "On the calendar." } }));
      } else if (p.kind === "shopping" && p.shopping) {
        const c = p.shopping;
        let call;
        if (c.via === "needed" && c.item_id) call = supabase.rpc("shopping_item_needed", { p_id: c.item_id, p_needed: true });
        else if (c.via === "request") call = supabase.rpc("shopping_request_create", { p_shelf_item_id: null, p_item_name: c.item_name, p_note: c.note, p_photo_path: null });
        else call = supabase.rpc("shopping_item_save", { p_id: null, p_name: c.item_name, p_needed: true, p_note: c.note });
        const { data, error } = await call;
        const res = data as { ok: boolean; message?: string; id?: string } | null;
        if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? "Could not save.");
        setPstate((s) => ({ ...s, [p.id]: { status: "saved", href: c.via === "request" ? "/send" : "/shopping", note: c.via === "request" ? "Sent for approval." : "On the list." } }));
      } else if (p.kind === "plan" && p.plan) {
        const { data, error } = await supabase.rpc("coach_plan_start", { p_subject_id: p.plan.subject_id, p_goal: p.plan.goal, p_steps: p.plan.steps });
        const res = data as { ok: boolean; message?: string } | null;
        if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? "Could not start the plan.");
        setPstate((s) => ({ ...s, [p.id]: { status: "saved", href: "/", note: "Plan started. Today's step is on Home." } }));
      } else if (p.kind === "memory" && p.memory) {
        const { data, error } = await supabase.rpc("memory_add", { p_body: p.memory.body });
        const res = data as { ok: boolean; message?: string } | null;
        if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? "Could not save.");
        setPstate((s) => ({ ...s, [p.id]: { status: "saved", href: "/ask/memory", note: "Remembered." } }));
      } else {
        throw new Error("I do not know how to save that.");
      }
      if (talkRef.current) startListeningRef.current();
      router.refresh();
    } catch (e) {
      setPstate((s) => ({ ...s, [p.id]: { status: "error", message: e instanceof Error ? e.message : "Could not save." } }));
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
                    <span className="muted block text-xs">{new Date(c.updated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
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
              {m.role === "user" ? <p>{m.text}</p> : <Cited text={m.text} refs={m.refs} />}
            </div>
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
        {busy && (
          <li className="self-start">
            <div className="bubble muted">Looking…</div>
          </li>
        )}
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
