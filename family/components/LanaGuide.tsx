"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { EntryRow } from "@/lib/types";
import { tipsFor } from "@/lib/child-guide";
import { useMe } from "@/lib/me-context";
import { child, childName, possessive } from "@/lib/names";
import { Fold } from "./Fold";

/**
 * The last 24 hours against the child's age, as tips, in a fold on the child's page. Quiet
 * when all is well, and always from 12 months (lib/child-guide: no tips for a toddler).
 */
export function LanaGuide({ entries, birthDate, timezone, feedGapMin, flat = false }: { entries: EntryRow[]; birthDate: string | null; timezone?: string; feedGapMin?: number; /** A row of the white list on the child's Today tab. */ flat?: boolean }) {
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
  // The guide is a fold, shut like every fold (DESIGN.md), open by itself only for a red tip:
  // one that says to call the doctor. No tips, no fold.
  if (tips.length === 0) return null;
  const worst = tips.find((t) => t.level === "red") ? "red" : tips.find((t) => t.level === "yellow") ? "yellow" : null;
  const shown = more ? tips : tips.slice(0, 1);
  // Flat in the fold (no box in a box), one line of colour for how urgent, one link at the foot.
  return (
    <Fold title={`${possessive(childName(me))} guide`} icon="sparkles" tint={worst === "red" ? "danger" : worst === "yellow" ? "meds" : "guide"} hint={`${tips.length} to read`} open={worst === "red"} flat={flat}>
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
