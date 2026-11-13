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
  // In the fold: the most pressing tip, the rest behind "N more" (DESIGN.md rule 3).
  const [more, setMore] = useState(false);
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
            <Link prefetch={false} href={`/baby/when-to-call/${tip.topic}`} className="inline-flex min-h-[44px] items-center text-sm font-semibold underline">
              When to call the doctor
            </Link>
          </div>
        ))
      )}
    </>
  );
  // On the child's page the guide is a fold, shut like every fold (DESIGN.md), open by itself
  // only for a red tip: one that says to call the doctor.
  if (fold) {
    if (tips.length === 0) return null;
    const worst = tips.find((t) => t.level === "red") ? "red" : tips.find((t) => t.level === "yellow") ? "yellow" : null;
    const shown = more ? tips : tips.slice(0, 1);
    // Flat in the fold (no box in a box), one line of colour for how urgent, one link at the foot.
    return (
      <Fold title={`${possessive(childName(me))} guide`} icon="sparkles" tint={worst === "red" ? "danger" : worst === "yellow" ? "meds" : "guide"} hint={`${tips.length} to read`} open={worst === "red"}>
        {shown.map((tip, i) => (
          <div key={tip.title} className={i ? "border-t border-[var(--line)] pt-3" : ""}>
            <p className={`font-semibold ${tip.level === "red" ? "text-[var(--danger)]" : tip.level === "yellow" ? "text-[var(--warn)]" : "text-[var(--fg)]"}`}>{tip.title}</p>
            <p className="mt-1 text-sm text-[var(--fg)]">{tip.body}</p>
          </div>
        ))}
        {!more && tips.length > 1 && (
          <button type="button" className="self-start font-semibold text-[var(--accent)]" onClick={() => setMore(true)}>
            {tips.length - 1} more
          </button>
        )}
        {worst && (
          <Link prefetch={false} href={`/baby/when-to-call/${tips[0].topic}`} className="inline-flex min-h-[44px] items-center font-semibold text-[var(--fg)]">
            When to call the doctor ›
          </Link>
        )}
      </Fold>
    );
  }
  return (
    <section className="flex flex-col gap-2" aria-labelledby="guide-h">
      <div className="flex items-baseline justify-between">
        <h2 id="guide-h" className="section-title">{possessive(childName(me))} guide</h2>
        <Link prefetch={false} href="/baby/when-to-call" className="text-sm font-semibold text-[var(--accent)]">
          When to call ›
        </Link>
      </div>
      {body}
    </section>
  );
}
