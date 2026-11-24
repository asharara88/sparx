import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DayStats, EntryRow, HomeSummary, Me, MilkData, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, dayRange, todayYmd } from "@/lib/time";
import { meOnce } from "@/lib/server/me";
import { PageHeader } from "@/components/PageHeader";
import { FeedDay, FeedPastDay, type SectionDay } from "@/components/FeedDay";
import { EntryList } from "@/components/EntryList";
import { DayBar } from "@/components/DayBar";
import { DayPager } from "@/components/DayPager";
import { SectionSwitch } from "@/components/SectionSwitch";
import { LanaNow } from "@/components/LanaNow";
import { dayNav } from "@/lib/day-nav";
import { defaultMilk } from "@/lib/milk-take";
import { nightWindow } from "@/lib/night";
import { Fold } from "@/components/Fold";
import { ageDays, normsForAge } from "@/lib/norms";
import { dayLabel } from "@/lib/by-day";
import { stageFor } from "@/lib/stage";
import { napPattern } from "@/lib/child-insights";
import { dayFacts, dayPlan, readDay } from "@/lib/day";

export const dynamic = "force-dynamic";

/**
 * Feeds, one day at a time (DESIGN.md, "The Sleep and Feeds sections"; redrawn 24 November).
 * Under the title, Feeds | Sleep crosses to the other section. Then, on today, the two
 * buttons that open Home's feed sheet over this screen, or the feed that is running with its
 * stop. Then the day: a pager ("Today, Tue 24 Nov", arrows, a swipe), the day's card (when the
 * next is due on today, the day's bar with the feeds over the sleep, what went in, the night
 * before) and that day's feeds to fix or delete. Last, the week against what is usual at her
 * age. A day before today has no buttons: it is for reading and fixing.
 * From 12 months there is no usual number of feeds (lib/norms): no "usually" hint, the night
 * only when a night feed was logged, and the week only when feeds were logged. With a saved
 * day (lib/day.ts) today's card follows it: the next feed again for a family that keeps the
 * clock, "Milk today" where milk is a drink.
 */
export default async function FeedPage({ searchParams }: { searchParams: Promise<{ day?: string | string[] }> }) {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const nav = dayNav((await searchParams).day, today);
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  const feedType = summary.types.find((t) => t.key === "feed");
  if (!feedType) redirect("/baby");
  const canAdd = can(me, "lana", "add");
  // A day more than the pager reaches, so the first day's bar has the night it woke from.
  const weekFrom = dayRange(addDays(today, -7), tz).from;
  const [{ data: listData }, { data: statsData }, { data: milkData }] = await Promise.all([
    supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: weekFrom, p_to: new Date(Date.now() + 3_600_000).toISOString() }),
    supabase.rpc("care_daily_stats", { p_subject_id: summary.subject.id, p_from: addDays(today, -7), p_to: today }),
    // The stash only says which milk the bottle sheet starts on (as on Home), so only where a bottle can be logged.
    canAdd && nav.isToday ? supabase.rpc("milk_list") : Promise.resolve({ data: null }),
  ]);
  const all = ((listData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
  // The week as it has always been read here (today and the six days before): the lists, the plan.
  const weekStart = Date.parse(dayRange(addDays(today, -6), tz).from);
  const entries = all.filter((e) => Date.parse(e.occurred_at) >= weekStart);
  const feeds = entries.filter((e) => e.type_id === feedType.id);
  const stats = ((statsData as { days?: DayStats[] } | null)?.days ?? []) as DayStats[];
  const days = stats.filter((d) => d.day < today);
  // The night that ended on the morning of the day shown.
  const nightBefore = stats.find((d) => d.day === addDays(nav.day, -1));
  const usual = summary.subject.birth_date ? normsForAge(ageDays(summary.subject.birth_date, today)).feeds : null;
  const toddler = stageFor(summary.subject.birth_date, Date.now(), tz).toddler;
  // From 12 months a kind the family does not log reads as nothing, not as a row of zeros (R8).
  const fedThisWeek = !toddler || days.some((d) => d.breast_count + d.bottle_count > 0);
  // The family's day, when one is saved and counts at this age; with none today's card is as before.
  // Only the card's two keys are read from the plan here: the page does not read the milk stash.
  const now = Date.now();
  const age = summary.subject.birth_date ? ageDays(summary.subject.birth_date, today) : null;
  const day = readDay(summary.subject.settings, age, summary.subject.birth_date);
  const pattern = napPattern(entries, age, now, tz, now - 7 * 86_400_000, day?.naps ?? null);
  const { feedCard, milk } = dayPlan(day, age, dayFacts(summary, { now, today, tz, breastfeeds: !!me.member.breastfeeds, inStock: false, week: entries, pattern }));

  const range = dayRange(nav.day, tz);
  const [dayFrom, dayTo] = [Date.parse(range.from), Date.parse(range.to)];
  const dayFeeds = feeds.filter((e) => Date.parse(e.occurred_at) >= dayFrom && Date.parse(e.occurred_at) < dayTo).sort((x, y) => Date.parse(y.occurred_at) - Date.parse(x.occurred_at));
  const nowIso = new Date(now).toISOString();
  const nightFeeds = nightBefore && (nightBefore.night_feeds > 0 || (nightBefore.night_sleep_min > 0 && !toddler)) ? nightBefore.night_feeds : null;
  const sectionDay: SectionDay = {
    bar: <DayBar entries={all} day={nav.day} timezone={tz} nowIso={nowIso} night={nightWindow(summary.subject.settings)} lead="feeds" />,
    count: !toddler,
    night: nightFeeds == null ? null : `${nav.isToday ? "Last night" : "The night before"}: ${nightFeeds} ${nightFeeds === 1 ? "feed" : "feeds"}`,
  };
  // The milk the bottle sheet starts on, by Home's rule (lib/milk-take.ts, X10).
  const milkStash = milkData as MilkData | RpcError | null;
  const inStock = !!milkStash && milkStash.ok && milkStash.fridge_count + milkStash.freezer_count > 0;
  const named = (e: EntryRow) => e.payload.method === "Bottle" && typeof e.payload.milk === "string";
  const firstMilk = defaultMilk({ lastMilk: (feeds.find(named)?.payload.milk as string | undefined) ?? null, everPumped: !!summary.last["lana.pump"], inStock, namedMilkThisWeek: feeds.some((e) => named(e) && String(e.payload.milk).trim() !== "") });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/" title="Feeds" />
      <SectionSwitch current="feed" day={nav.day} today={today} />
      {canAdd && nav.isToday && (
        <LanaNow section="feed" subject={summary.subject} types={summary.types} ongoing={summary.ongoing} recent={entries} timezone={tz} clockIso={nowIso} defaultMilk={firstMilk} lastFeedMethod={(summary.last["lana.feed"]?.payload?.method as string | undefined) ?? null} />
      )}
      <DayPager base="/baby/feed" nav={nav} today={today} />
      {nav.isToday ? (
        <FeedDay summary={summary} entries={entries} dayStartMs={dayFrom} dayEndMs={dayTo} timezone={tz} nowIso={nowIso} today={today} plan={{ feedCard, milk }} section={sectionDay} />
      ) : (
        // From 12 months a family that does not log milk has no card for it, on any day (R8).
        (!toddler || dayFeeds.length > 0) && <FeedPastDay feeds={dayFeeds} section={sectionDay} />
      )}
      {dayFeeds.length > 0 ? (
        <EntryList entries={dayFeeds} types={summary.types} timezone={tz} canEdit={can(me, "lana", "edit")} canDelete={can(me, "lana", "delete")} />
      ) : (
        <p className="muted px-1 text-sm">{nav.isToday ? "None logged yet today." : "None logged that day."}</p>
      )}
      {days.length > 0 && fedThisWeek && (
        <Fold title="The week" icon="bottle" tint="feed" hint={usual ? `usually ${usual.low} to ${usual.high} a day` : null}>
          <ul className="flex flex-col">
            {[...days].reverse().map((d) => {
              const n = d.breast_count + d.bottle_count;
              return (
                <li key={d.day} className="row">
                  <span className="w-24 shrink-0 font-semibold">{dayLabel(d.day, today)}</span>
                  <span className="muted min-w-0 flex-1 text-sm">
                    {n} {n === 1 ? "feed" : "feeds"}
                    {d.bottle_ml ? ` · ${d.bottle_ml} ml in bottles` : ""}
                    {d.breast_count ? ` · ${d.breast_count} breast` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </Fold>
      )}
    </div>
  );
}
