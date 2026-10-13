import Link from "next/link";
import type { MilkData } from "@/lib/types";
import { fmtTime } from "@/lib/time";

/**
 * Planned bottles until Mama is back, against what is in the fridge. One
 * bottle every interval from the next due time, each the size of the last
 * bottle. Says how many freezer bags to thaw if the fridge will run short.
 */
export function FridgePlan({ milk, lastFeedAt, backAtIso, bottleMl, timezone }: { milk: MilkData; lastFeedAt: string | null; backAtIso: string; bottleMl: number; timezone: string }) {
  const interval = (milk.bottle_interval_min || 120) * 60_000;
  const now = Date.now();
  const back = Date.parse(backAtIso);
  if (!(back > now)) return null;
  let next = lastFeedAt ? Date.parse(lastFeedAt) + interval : now;
  if (next < now) next = now;
  const planned: number[] = [];
  for (let t = next; t <= back && planned.length < 8; t += interval) planned.push(t);
  if (planned.length === 0) return null;
  const need = planned.length * bottleMl;
  const short = Math.max(0, need - milk.fridge_ml);
  const freezer = milk.bottles.filter((b) => b.location === "freezer" && !b.expired).sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  let covered = 0;
  const thaw: typeof freezer = [];
  for (const b of freezer) {
    if (covered >= short) break;
    thaw.push(b);
    covered += b.amount_ml;
  }
  return (
    <section className={`card flex flex-col gap-1 ${short > 0 ? "border border-[var(--warn)]" : ""}`} aria-labelledby="plan-h">
      <h2 id="plan-h" className="section-title">Until Mama is back</h2>
      <p>
        <b>{planned.length}</b> bottle{planned.length === 1 ? "" : "s"} of about {bottleMl} ml planned: {planned.map((t) => fmtTime(new Date(t).toISOString(), timezone)).join(", ")}.
      </p>
      <p className="muted text-sm">
        Needs about {need} ml. The fridge has {milk.fridge_ml} ml.
      </p>
      {short > 0 ? (
        <p className="notice notice-warn text-sm">
          {short} ml short. {thaw.length > 0 ? `Thaw ${thaw.length} freezer bag${thaw.length === 1 ? "" : "s"} (${thaw.map((b) => `${b.amount_ml} ml`).join(", ")}) now.` : "No freezer milk either: formula for the last bottle."}
          {" "}
          <Link href="/lana/milk" className="underline">
            Milk stash
          </Link>
        </p>
      ) : (
        <p className="text-sm text-[var(--ok)]">Enough in the fridge{milk.fridge_ml - need >= bottleMl ? `, with ${milk.fridge_ml - need} ml spare` : ""}.</p>
      )}
    </section>
  );
}
