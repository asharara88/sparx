"use client";
import { apiFetch } from "@/lib/supabase/client";
import { warmUtterance } from "@/lib/voice";

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

/** `bcp47` picks the phone voice when the app's voice is not there; `onEnd` runs once, when it has been said or stopped. */
export function speak(text: string, bcp47: string, onEnd?: () => void): void {
  stopSpeaking();
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    onEnd?.();
  };
  const phone = () => {
    if (typeof speechSynthesis === "undefined" || !text.trim()) return end();
    const u = warmUtterance(text, bcp47);
    u.onend = end;
    u.onerror = end;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    current = () => {
      speechSynthesis.cancel();
      end();
    };
  };
  if (serverOff || typeof Audio === "undefined" || !text.trim()) return phone();
  unlockAudio();
  const ctl = new AbortController();
  let url: string | null = null;
  const audio = (el ??= new Audio());
  const release = () => {
    if (url) URL.revokeObjectURL(url);
    url = null;
  };
  current = () => {
    ctl.abort();
    audio.pause();
    release();
    end();
  };
  void (async () => {
    try {
      const res = await apiFetch("/api/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal: ctl.signal });
      if (res.status === 503) serverOff = true;
      if (!res.ok) throw new Error(String(res.status));
      url = URL.createObjectURL(await res.blob());
      audio.src = url;
      audio.onended = () => {
        release();
        end();
      };
      await audio.play();
    } catch {
      if (ctl.signal.aborted) return;
      release();
      phone();
    }
  })();
}
