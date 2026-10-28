"use client";
import { useEffect, useState } from "react";
import { speechLang, type Lang } from "@/lib/i18n";
import { Icon } from "@/components/Icon";
import { primeVoices, warmUtterance } from "@/lib/voice";

/** Reads a sentence aloud in the member's language with the phone's own warmest female voice (lib/voice.ts). */
export function ListenButton({ text, lang, label }: { text: string; lang: Lang; label: string }) {
  const [can, setCan] = useState(false);
  const [on, setOn] = useState(false);
  useEffect(() => {
    setCan(typeof speechSynthesis !== "undefined");
    primeVoices();
  }, []);
  useEffect(() => () => {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }, []);
  if (!can) return null;
  function speak() {
    if (on) {
      speechSynthesis.cancel();
      setOn(false);
      return;
    }
    const u = warmUtterance(text, speechLang(lang));
    u.onend = () => setOn(false);
    u.onerror = () => setOn(false);
    speechSynthesis.cancel();
    setOn(true);
    speechSynthesis.speak(u);
  }
  return (
    <button type="button" className={`btn ${on ? "btn-primary" : ""}`} style={{ minHeight: 64, fontSize: "1.25rem" }} onClick={speak} aria-pressed={on}>
      <Icon name="volume" size={28} /> {label}
    </button>
  );
}
