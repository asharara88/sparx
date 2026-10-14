"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { EntryRow } from "@/lib/types";
import { tipsFor } from "@/lib/lana-guide";
import { Icon } from "./Icon";

/** The last 24 hours against her age, as tips. Quiet when all is well. */
export function LanaGuide({ entries, birthDate, timezone, feedGapMin }: { entries: EntryRow[]; birthDate: string | null; timezone?: string; feedGapMin?: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (now == null) return null;
  const tips = tipsFor(entries, birthDate, now, { timezone, feedGapMin });
  return (
    <section className="flex flex-col gap-2" aria-labelledby="guide-h">
      <div className="flex items-baseline justify-between">
        <h2 id="guide-h" className="section-title">Lana's guide</h2>
        <Link href="/lana/when-to-call" className="text-sm font-semibold text-[var(--accent)]">
          When to call ›
        </Link>
      </div>
      {tips.length === 0 ? (
        <p className="notice notice-ok flex items-center gap-2">
          <Icon name="check" size={18} /> All on track for her age: feeds, diapers and sleep look usual.
        </p>
      ) : (
        tips.map((tip) => (
          <div key={tip.title} className={`notice ${tip.level === "red" ? "notice-danger" : tip.level === "yellow" ? "notice-warn" : ""}`}>
            <p className="font-semibold">{tip.title}</p>
            <p className="mt-1 text-sm opacity-90">{tip.body}</p>
            <Link href={`/lana/when-to-call#${tip.topic}`} className="mt-1 inline-block text-sm font-semibold underline">
              When to call the doctor
            </Link>
          </div>
        ))
      )}
    </section>
  );
}
