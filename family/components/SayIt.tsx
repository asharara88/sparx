"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMe } from "@/lib/me-context";
import { speechLang, type Lang } from "@/lib/i18n";
import { Icon } from "@/components/Icon";

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * One mic on Home: say "she drank 90 ml" or "wet nappy" and it goes to Ask,
 * which prepares the entry for a one-tap Confirm. Nothing is saved from here.
 */
export function SayIt() {
  const me = useMe();
  const router = useRouter();
  const [can, setCan] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const recRef = useRef<Recognition | null>(null);
  useEffect(() => setCan(!!recognitionCtor()), []);
  if (!can) return null;

  function start() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = speechLang((me.member.lang ?? "en") as Lang);
    rec.interimResults = true;
    rec.continuous = false;
    let text = "";
    rec.onresult = (e) => {
      text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      setHeard(text);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      const q = text.trim();
      if (q) router.push(`/ask?say=${encodeURIComponent(q)}`);
    };
    recRef.current = rec;
    setHeard("");
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }

  return (
    <button type="button" className={`btn flex w-full items-center justify-center gap-2 ${listening ? "btn-primary" : ""}`} style={{ minHeight: 52 }} onClick={start} aria-pressed={listening}>
      {listening ? <span className="dot dot-danger" /> : <Icon name="mic" size={20} />}
      {listening ? (heard ? `“${heard}”` : "Listening… say a feed, a nappy or a sleep") : "Say it to log"}
    </button>
  );
}
