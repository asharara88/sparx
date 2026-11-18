import Link from "next/link";
import type { EntryRow, HomeSummary } from "@/lib/types";
import { ageDays } from "@/lib/norms";
import { feedCard } from "@/lib/logged";

/**
 * Feeds today, on Home below the log rows (pink, like every feed card): when the next one
 * is due, what went in today (bottles in ml, breastfeeds by count), and what is usual at her
 * age. The count of feeds is on the strip at the top, so it is not repeated. From 12 months
 * milk has no clock and no usual number: the day's sum and when the last was, and no card at
 * all for a family that has not logged a feed lately (lib/logged.ts, R8). Server-rendered.
 */
export function FeedDay({ summary, entries, dayStartMs, dayEndMs, timezone, nowIso, today, href = null }: { summary: HomeSummary; entries: EntryRow[]; dayStartMs: number; dayEndMs: number; timezone: string; nowIso: string; today: string; /** The Feeds section, linked at the foot of the card. */ href?: string | null }) {
  const c = feedCard({
    ageDays: summary.subject.birth_date ? ageDays(summary.subject.birth_date, today) : null,
    feeding: summary.ongoing.some((e) => e.type_id === "lana.feed"),
    nextDue: summary.last["lana.feed"]?.next_due ?? null,
    todayFeeds: entries.filter((e) => e.type_id === "lana.feed" && Date.parse(e.occurred_at) >= dayStartMs && Date.parse(e.occurred_at) < dayEndMs),
    lastFeedAt: summary.last["lana.feed"]?.occurred_at ?? null,
    today,
    tz: timezone,
    now: Date.parse(nowIso),
  });
  if (!c.show) return null;
  return (
    <section className="card tint-feed flex flex-col gap-1" aria-labelledby="feed-day-h">
      <h2 id="feed-day-h" className="section-title">Feeds today</h2>
      <p className="text-2xl font-bold">{c.headline}</p>
      {c.line && <p className="text-sm">{c.line}</p>}
      {c.usual && <p className="muted text-sm">{c.usual}</p>}
      {href && (
        <Link prefetch={false} href={href} className="row-link -mb-2 flex min-h-[44px] items-center justify-end font-semibold no-underline">
          All feeds ›
        </Link>
      )}
    </section>
  );
}
