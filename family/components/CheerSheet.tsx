"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CHEER_MAX, CHEER_WORDS, type CheerAbout } from "@/lib/cheers";
import { buzz } from "@/lib/moment";
import { Sheet } from "./Sheet";
import { SavedTick } from "./SavedTick";

/** What a cheer is about, as cheer_send takes it. */
export interface CheerTarget {
  to: { id: string; name: string };
  about: CheerAbout;
  refId?: string | null;
  refDay?: string | null;
  /** The words after "For": "last night", "the Bronze medal". */
  forWords: string;
}

/**
 * Send a cheer (DESIGN.md, "Cheers and shared nights"): three set lines, one tap each, or the
 * sender's own words. Nothing to fill in before the first tap, because the moment to say
 * "thank you" is short. After it is sent the sheet says so and stays until it is closed.
 */
export function CheerSheet({ target, extra, onClose }: { target: CheerTarget; /** One more set line, offered when it is true (a night, once the sender has the child). */ extra?: string | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [own, setOwn] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function send(words: string) {
    const text = words.trim();
    if (!text || busy) return;
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("cheer_send", { p_to: target.to.id, p_about: target.about, p_ref_id: target.refId ?? null, p_ref_day: target.refDay ?? null, p_words: text });
    setBusy(false);
    const res = data as { ok: boolean; already?: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not send that. Try again.");
    if (res.already) return setDone("You cheered this already.");
    buzz();
    setDone(`Sent to ${target.to.name}.`);
  }

  const lines = extra ? [...CHEER_WORDS, extra] : [...CHEER_WORDS];
  return (
    <Sheet title={`A cheer for ${target.to.name}`} onClose={onClose}>
      {done ? (
        <div className="flex flex-col gap-3 pb-2">
          <p role="status" className="notice notice-ok flex items-center gap-3">
            <SavedTick /> <span className="flex-1 font-semibold">{done}</span>
          </p>
          <button type="button" className="btn btn-primary" onClick={onClose} autoFocus>
            Done
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 pb-2">
          <p className="muted text-sm">For {target.forWords}</p>
          {lines.map((w) => (
            <button key={w} type="button" className="btn justify-start text-left" disabled={busy} onClick={() => void send(w)}>
              {w}
            </button>
          ))}
          <form
            className="mt-1 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(own);
            }}
          >
            <input id="cheer-own" className="input min-w-0 flex-1" value={own} maxLength={CHEER_MAX} onChange={(e) => setOwn(e.target.value)} placeholder="Or your own words" aria-label="Your own words" />
            <button type="submit" className="btn btn-primary" disabled={busy || !own.trim()}>
              Send
            </button>
          </form>
          {msg && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {msg}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
