"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AssistantProposal, AssistantRef, AssistantReply, AssistantTurn, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { newClientId, sendOrQueue } from "@/lib/offline";
import { Cited } from "./Cited";

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
}

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

export function Assistant({ suggestions }: { suggestions: string[] }) {
  const me = useMe();
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [night, setNight] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [pstate, setPstate] = useState<Record<string, ProposalState>>({});
  const recRef = useRef<Recognition | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const heardRef = useRef("");

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE) ?? "null") as { msgs: Msg[]; pstate: Record<string, ProposalState> } | null;
      if (saved?.msgs) {
        setMsgs(saved.msgs);
        setPstate(saved.pstate ?? {});
      }
    } catch {
      /* fresh start */
    }
    setCanSpeak(!!recognitionCtor());
    try {
      setNight(localStorage.getItem("family.ask.night") === "1");
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    if (night) document.documentElement.setAttribute("data-theme", "night");
    else document.documentElement.removeAttribute("data-theme");
    return () => document.documentElement.removeAttribute("data-theme");
  }, [night]);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ msgs, pstate }));
    } catch {
      /* ignore */
    }
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, pstate]);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      setInput("");
      setBusy(true);
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

  // ---- voice
  function toggleListening() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-GB";
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
      if (heard) void ask(heard); // one-handed: speak, and it sends itself
    };
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
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
      } else {
        throw new Error("I do not know how to save that.");
      }
      router.refresh();
    } catch (e) {
      setPstate((s) => ({ ...s, [p.id]: { status: "error", message: e instanceof Error ? e.message : "Could not save." } }));
    }
  }

  function clear() {
    setMsgs([]);
    setPstate({});
    try {
      sessionStorage.removeItem(STORE);
    } catch {
      /* ignore */
    }
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
      <header className="flex items-center justify-between gap-2 pt-2">
        <h1 className="text-2xl font-bold">Ask</h1>
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={toggleNight} aria-pressed={night} title="Dark screen for the night">
            {night ? "☀️ Day" : "🌙 Night"}
          </button>
          {msgs.length > 0 && (
            <button type="button" className="btn" onClick={clear}>
              Clear
            </button>
          )}
        </div>
      </header>

      {msgs.length === 0 && (
        <div className="card">
          <p className="font-semibold">Ask anything about the house, in your own words.</p>
          <p className="muted mt-1 text-sm">Every answer links to the entry it came from. {writer ? "You can also say “log a 120 ml bottle” — it prepares it and you tap Confirm." : "This role can read, not write."}</p>
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
                <div key={p.id} className="card mt-2 border-2 border-[var(--accent)]">
                  <p className="font-semibold">{p.summary}</p>
                  {st.status === "pending" && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button type="button" className="btn" onClick={() => setPstate((s) => ({ ...s, [p.id]: { status: "dropped" } }))}>
                        Not this
                      </button>
                      <button type="button" className="btn btn-primary min-h-[64px] text-lg" onClick={() => void confirm(p)}>
                        ✓ Confirm
                      </button>
                    </div>
                  )}
                  {st.status === "saving" && <p className="muted mt-1">Saving…</p>}
                  {st.status === "saved" && (
                    <p className="mt-1 font-semibold text-[var(--ok)]">
                      ✓ {st.note}{" "}
                      {st.href && (
                        <a href={st.href} className="underline">
                          Open
                        </a>
                      )}
                    </p>
                  )}
                  {st.status === "dropped" && <p className="muted mt-1">Not saved.</p>}
                  {st.status === "error" && (
                    <p className="mt-1 text-red-800" role="alert">
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
            {listening ? "●" : "🎤"}
          </button>
        )}
        <input className="input flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? "Listening…" : "Ask or tell me something"} aria-label="Your question" autoComplete="off" enterKeyHint="send" />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()} aria-label="Send">
          ➤
        </button>
      </form>
    </div>
  );
}
