import Link from "next/link";
import type { EntryRow, HomeSummary } from "@/lib/types";
import { ageDays } from "@/lib/norms";
import { feedCard } from "@/lib/logged";
import type { DayPlan } from "@/lib/day";

/**
 * Feeds today, on Home below the log rows (pink, like every feed card): when the next one
 * is due, what went in today (bottles in ml, breastfeeds by count), and what is usual at her
 * age. The count of feeds is on the strip at the top, so it is not repeated. From 12 months
 * milk has no clock and no usual number: the day's sum and when the last was, and no card at
 * all for a family that has not logged a feed lately (lib/logged.ts, R8). With a saved day
 * (lib/day.ts) the day says whether the card is drawn; a family that keeps the feed clock
 * gets the next feed back, and one whose milk is a drink reads "Milk today". Server-rendered.
 */
export function FeedDay({ summary, entries, dayStartMs, dayEndMs, timezone, nowIso, today, href = null, plan = null, usual: showUsual = true }: { summary: HomeSummary; entries: EntryRow[]; dayStartMs: number; dayEndMs: number; timezone: string; nowIso: string; today: string; /** The Feeds section, linked at the foot of the card. */ href?: string | null; /** The home's plan (lib/day.ts dayPlan). Absent, or with no saved day, the card is as it always was. */ plan?: Pick<DayPlan, "feedCard" | "milk"> | null; /** Off on Home since 24 November: what is usual at her age is said on the Feeds section. */ usual?: boolean }) {
  const c = feedCard({
    ageDays: summary.subject.birth_date ? ageDays(summary.subject.birth_date, today) : null,
    feeding: summary.ongoing.some((e) => e.type_id === "lana.feed"),
    nextDue: summary.last["lana.feed"]?.next_due ?? null,
    todayFeeds: entries.filter((e) => e.type_id === "lana.feed" && Date.parse(e.occurred_at) >= dayStartMs && Date.parse(e.occurred_at) < dayEndMs),
    lastFeedAt: summary.last["lana.feed"]?.occurred_at ?? null,
    today,
    tz: timezone,
    now: Date.parse(nowIso),
    day: plan?.feedCard ?? null,
  });
  if (!c.show) return null;
  return (
    <section className="card tint-feed flex flex-col gap-1" aria-labelledby="feed-day-h">
      <h2 id="feed-day-h" className="section-title">{plan?.milk === "drink" ? "Milk today" : "Feeds today"}</h2>
      <p className="text-2xl font-bold">{c.headline}</p>
      {c.line && <p className="text-sm">{c.line}</p>}
      {showUsual && c.usual && <p className="muted text-sm">{c.usual}</p>}
      {href && (
        <Link prefetch={false} href={href} className="row-link -mb-2 flex min-h-[44px] items-center justify-end font-semibold no-underline">
          All feeds ›
        </Link>
      )}
    </section>
  );
}
