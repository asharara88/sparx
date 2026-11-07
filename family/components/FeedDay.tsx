import type { EntryRow, HomeSummary } from "@/lib/types";
import { fmtTime } from "@/lib/time";
import { ageDays, normsForAge } from "@/lib/norms";

/**
 * Feeds today, on Home below the log rows (pink, like every feed card): when the next one
 * is due, what went in today (bottles in ml, breastfeeds by count), and what is usual at her
 * age. The count of feeds is on the strip at the top, so it is not repeated. Server-rendered.
 */
export function FeedDay({ summary, entries, dayStartMs, dayEndMs, timezone, nowIso, today }: { summary: HomeSummary; entries: EntryRow[]; dayStartMs: number; dayEndMs: number; timezone: string; nowIso: string; today: string }) {
  const now = Date.parse(nowIso);
  const feeds = entries.filter((e) => e.type_id === "lana.feed" && Date.parse(e.occurred_at) >= dayStartMs && Date.parse(e.occurred_at) < dayEndMs);
  const bottles = feeds.filter((e) => e.payload.method === "Bottle");
  const ml = bottles.reduce((a, e) => a + (Number(e.payload.amount_ml) || 0), 0);
  const breast = feeds.length - bottles.length;
  const feeding = summary.ongoing.some((e) => e.type_id === "lana.feed");
  const due = summary.last["lana.feed"]?.next_due ?? null;
  const headline = feeding ? "Feeding now" : due ? (Date.parse(due) <= now ? "Feed due now" : `Next feed about ${fmtTime(due, timezone)}`) : "No feed logged yet";
  const parts = [bottles.length ? `${ml ? `${ml} ml in ` : ""}${bottles.length} ${bottles.length === 1 ? "bottle" : "bottles"}` : null, breast ? `${breast} ${breast === 1 ? "breastfeed" : "breastfeeds"}` : null].filter(Boolean);
  const norms = summary.subject.birth_date ? normsForAge(ageDays(summary.subject.birth_date, today)) : null;
  return (
    <section className="card tint-feed flex flex-col gap-1" aria-labelledby="feed-day-h">
      <h2 id="feed-day-h" className="section-title">Feeds today</h2>
      <p className="text-2xl font-bold">{headline}</p>
      <p className="text-sm">{parts.length ? parts.join(" · ") : "Nothing yet today."}</p>
      {norms && <p className="muted text-sm">Usual at this age: {norms.feeds.low} to {norms.feeds.high} feeds a day.</p>}
    </section>
  );
}
