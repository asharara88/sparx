"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { EntryRow } from "@/lib/types";
import { tipsFor } from "@/lib/child-guide";
import { useMe } from "@/lib/me-context";
import { child, childName, childPronouns, possessive } from "@/lib/names";
import { Icon } from "./Icon";
import { Fold } from "./Fold";

/** The last 24 hours against the child's age, as tips. Quiet when all is well. */
export function LanaGuide({ entries, birthDate, timezone, feedGapMin, fold = false }: { entries: EntryRow[]; birthDate: string | null; timezone?: string; feedGapMin?: number; fold?: boolean }) {
  const me = useMe();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (now == null) return null;
  const tips = tipsFor(entries, birthDate, now, { timezone, feedGapMin, name: childName(me), sex: child(me)?.sex });
  const body = (
    <>
      {tips.length === 0 ? (
        <p className="notice notice-ok flex items-center gap-2">
          <Icon name="check" size={18} /> All on track for {childPronouns(me).their} age: feeds, diapers and sleep look usual.
        </p>
      ) : (
        tips.map((tip) => (
          <div key={tip.title} className={`notice ${tip.level === "red" ? "notice-danger" : tip.level === "yellow" ? "notice-warn" : ""}`}>
            <p className="font-semibold">{tip.title}</p>
            <p className="mt-1 text-sm opacity-90">{tip.body}</p>
            <Link href={`/baby/when-to-call#${tip.topic}`} className="mt-1 inline-block text-sm font-semibold underline">
              When to call the doctor
            </Link>
          </div>
        ))
      )}
    </>
  );
  // On Home the guide is a fold: shut when all is well, open when a tip needs reading.
  if (fold) {
    if (tips.length === 0) return null;
    const worst = tips.find((t) => t.level === "red") ? "red" : tips.find((t) => t.level === "yellow") ? "yellow" : null;
    return (
      <Fold title={`${possessive(childName(me))} guide`} icon="sparkles" tint={worst === "red" ? "danger" : worst === "yellow" ? "meds" : "guide"} hint={`${tips.length} to read`} open>
        {body}
      </Fold>
    );
  }
  return (
    <section className="flex flex-col gap-2" aria-labelledby="guide-h">
      <div className="flex items-baseline justify-between">
        <h2 id="guide-h" className="section-title">{possessive(childName(me))} guide</h2>
        <Link href="/baby/when-to-call" className="text-sm font-semibold text-[var(--accent)]">
          When to call ›
        </Link>
      </div>
      {body}
    </section>
  );
}
