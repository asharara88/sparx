"use client";
import { apiFetch } from "@/lib/supabase/client";
import { speechChunks, warmUtterance } from "@/lib/voice";

/**
 * Say something aloud in the app's voice (ElevenLabs, through /api/speak), else in the
 * phone's warmest female voice: when no voice is set up on the server, it fails, or the
 * phone will not play the sound. One thing is said at a time; a new one stops the last.
 */

/** The server has no voice: the phone speaks for the rest of this visit. */
let serverOff = false;
let el: HTMLAudioElement | null = null;
let current: (() => void) | null = null;
const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

/**
 * iPhones only play sound a tap started. Call this in the tap (Listen, send, talk): the
 * one audio element plays a silent sound now, and may play the answer when it arrives.
 */
export function unlockAudio(): void {
  if (typeof Audio === "undefined" || serverOff) return;
  el ??= new Audio();
  if (el.paused) {
    el.src = SILENT;
    void el.play().catch(() => undefined);
  }
}

export function stopSpeaking(): void {
  current?.();
  current = null;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

/**
 * `bcp47` picks the phone voice when the app's voice is not there. `onEnd` runs once,
 * only when everything has been said; `onStop` runs instead when it is stopped or
 * replaced by something new (so talk mode does not start listening over a new answer).
 */
export function speak(text: string, bcp47: string, onEnd?: () => void, onStop?: () => void): void {
  stopSpeaking();
  let settled = false;
  const end = () => {
    if (settled) return;
    settled = true;
    onEnd?.();
  };
  const stop = () => {
    if (settled) return;
    settled = true;
    onStop?.();
  };
  const phone = () => {
    if (typeof speechSynthesis === "undefined" || !text.trim()) return end();
    const u = warmUtterance(text, bcp47);
    u.onend = end;
    u.onerror = end;
    current = () => {
      stop(); // first, so the cancel's own end event finds it settled
      speechSynthesis.cancel();
    };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };
  if (serverOff || typeof Audio === "undefined" || !text.trim()) return phone();
  unlockAudio();
  const ctl = new AbortController();
  const audio = (el ??= new Audio());
  const urls: string[] = [];
  const release = () => urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  current = () => {
    stop();
    ctl.abort();
    audio.pause();
    release();
  };
  // Long answers go in pieces (the server takes up to SPEECH_MAX_CHARS a call): the next
  // piece is fetched while this one plays, so the reading does not stop halfway.
  const pieces = speechChunks(text);
  const fetchPiece = async (piece: string) => {
    const res = await apiFetch("/api/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: piece }), signal: ctl.signal });
    if (res.status === 503) serverOff = true;
    if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(await res.blob());
    urls.push(url);
    return url;
  };
  const playUrl = (url: string) =>
    new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("audio"));
      audio.src = url;
      audio.play().catch(reject);
    });
  void (async () => {
    let said = 0;
    try {
      let next = fetchPiece(pieces[0]);
      for (let i = 0; i < pieces.length; i++) {
        const url = await next;
        if (i + 1 < pieces.length) next = fetchPiece(pieces[i + 1]);
        await playUrl(url);
        said = i + 1;
      }
      release();
      end();
    } catch {
      if (ctl.signal.aborted || settled) return;
      release();
      // The app's voice failed: the phone says what is left.
      text = pieces.slice(said).join(" ");
      phone();
    }
  })();
}
