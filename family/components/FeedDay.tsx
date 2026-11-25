import Link from "next/link";
import type { EntryRow, HomeSummary } from "@/lib/types";
import { ageDays } from "@/lib/norms";
import { feedCard, feedSums } from "@/lib/logged";
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
export function FeedDay({ summary, entries, dayStartMs, dayEndMs, timezone, nowIso, today, href = null, plan = null, usual: showUsual = true, section = null }: { summary: HomeSummary; entries: EntryRow[]; dayStartMs: number; dayEndMs: number; timezone: string; nowIso: string; today: string; /** The Feeds section, linked at the foot of the card. */ href?: string | null; /** The home's plan (lib/day.ts dayPlan). Absent, or with no saved day, the card is as it always was. */ plan?: Pick<DayPlan, "feedCard" | "milk"> | null; /** Off on Home since 24 November: what is usual at her age is said on the Feeds section. */ usual?: boolean; /** On the Feeds section (SectionDay below): the pager names the day, so no title; the day's bar; the count before the sums; a line for the night. */ section?: SectionDay | null }) {
  const todayFeeds = entries.filter((e) => e.type_id === "lana.feed" && Date.parse(e.occurred_at) >= dayStartMs && Date.parse(e.occurred_at) < dayEndMs);
  const c = feedCard({
    ageDays: summary.subject.birth_date ? ageDays(summary.subject.birth_date, today) : null,
    feeding: summary.ongoing.some((e) => e.type_id === "lana.feed"),
    nextDue: summary.last["lana.feed"]?.next_due ?? null,
    todayFeeds,
    lastFeedAt: summary.last["lana.feed"]?.occurred_at ?? null,
    today,
    tz: timezone,
    now: Date.parse(nowIso),
    day: plan?.feedCard ?? null,
  });
  if (!c.show) return null;
  const name = plan?.milk === "drink" ? "Milk today" : "Feeds today";
  if (section) {
    const line = section.count && todayFeeds.length && c.line ? `${feedCount(todayFeeds.length)} · ${c.line}` : c.line;
    return (
      <section className="card tint-feed flex flex-col gap-1" aria-label={name}>
        <p className="card-head">{c.headline}</p>
        {section.bar}
        {line && <p className="text-sm">{line}</p>}
        {section.night && <p className="text-sm opacity-80">{section.night}</p>}
      </section>
    );
  }
  return (
    <section className="card tint-feed flex flex-col gap-1" aria-labelledby="feed-day-h">
      <h2 id="feed-day-h" className="section-title">{name}</h2>
      <p className="card-head">{c.headline}</p>
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

/** What the Feeds section adds to the day's card. */
export interface SectionDay {
  /** The day's bar (DayBar), under the headline. */
  bar: React.ReactNode;
  /** "4 feeds · " before the day's sums: for a baby, whose headline is the next feed. */
  count: boolean;
  /** "Last night: 3 feeds", or null. */
  night: string | null;
}

const feedCount = (n: number) => `${n} ${n === 1 ? "feed" : "feeds"}`;

/** A day before today on the Feeds section: how many, the day's bar, what went in. No next feed and nothing usual: the day is over. */
export function FeedPastDay({ feeds, section }: { /** That day's feeds. */ feeds: EntryRow[]; section: SectionDay }) {
  const sums = feedSums(feeds);
  return (
    <section className="card tint-feed flex flex-col gap-1" aria-label="Feeds that day">
      <p className="card-head">{feeds.length ? feedCount(feeds.length) : "No feed logged"}</p>
      {section.bar}
      {sums && <p className="text-sm">{sums}</p>}
      {section.night && <p className="text-sm opacity-80">{section.night}</p>}
    </section>
  );
}
