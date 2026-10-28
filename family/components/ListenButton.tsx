"use client";
import { useEffect, useState } from "react";
import { speechLang, type Lang } from "@/lib/i18n";
import { Icon } from "@/components/Icon";
import { primeVoices } from "@/lib/voice";
import { speak as sayAloud, stopSpeaking } from "@/lib/speak";

/** Reads a sentence aloud in the member's language, in the app's voice (lib/speak.ts). */
export function ListenButton({ text, lang, label }: { text: string; lang: Lang; label: string }) {
  const [can, setCan] = useState(false);
  const [on, setOn] = useState(false);
  useEffect(() => {
    setCan(typeof speechSynthesis !== "undefined");
    primeVoices();
  }, []);
  useEffect(() => () => stopSpeaking(), []);
  if (!can) return null;
  function speak() {
    if (on) {
      stopSpeaking();
      setOn(false);
      return;
    }
    setOn(true);
    sayAloud(text, speechLang(lang), () => setOn(false));
  }
  return (
    <button type="button" className={`btn ${on ? "btn-primary" : ""}`} style={{ minHeight: 64, fontSize: "1.25rem" }} onClick={speak} aria-pressed={on}>
      <Icon name="volume" size={28} /> {label}
    </button>
  );
}
