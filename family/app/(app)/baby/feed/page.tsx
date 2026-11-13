import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DayStats, EntryRow, HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, dayRange, todayYmd } from "@/lib/time";
import { meOnce } from "@/lib/server/me";
import { PageHeader } from "@/components/PageHeader";
import { FeedDay } from "@/components/FeedDay";
import { DayEntries } from "@/components/DayEntries";
import { Fold } from "@/components/Fold";
import { ageDays, normsForAge } from "@/lib/norms";
import { dayLabel } from "@/lib/by-day";

export const dynamic = "force-dynamic";

/**
 * Feeds, all of them in one place (Mido, 7 November): reached from every pink card. Now
 * (start a breastfeed or log a bottle), today (when the next is due, what went in), last
 * night, every feed of the week to fix or delete, and the week's feeds against what is usual
 * at her age.
 */
export default async function FeedPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  const feedType = summary.types.find((t) => t.key === "feed");
  if (!feedType) redirect("/baby");
  const weekFrom = dayRange(addDays(today, -6), tz).from;
  const [{ data: listData }, { data: statsData }] = await Promise.all([
    supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: weekFrom, p_to: new Date(Date.now() + 3_600_000).toISOString() }),
    supabase.rpc("care_daily_stats", { p_subject_id: summary.subject.id, p_from: addDays(today, -7), p_to: today }),
  ]);
  const entries = ((listData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
  const feeds = entries.filter((e) => e.type_id === feedType.id);
  const days = (((statsData as { days?: DayStats[] } | null)?.days ?? []) as DayStats[]).filter((d) => d.day < today);
  const lastNight = days.find((d) => d.day === addDays(today, -1));
  const norms = summary.subject.birth_date ? normsForAge(ageDays(summary.subject.birth_date, today)) : null;
  const flag = feedType.settings?.timer_flag;
  const breastfeeds = !!flag && !!(me.member as unknown as Record<string, unknown>)[flag];
  const canAdd = can(me, "lana", "add");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/" title="Feeds" />
      {canAdd && (
        <div className={`grid ${breastfeeds ? "grid-cols-2" : "grid-cols-1"} gap-2`}>
          {breastfeeds && (
            <Link prefetch={false} href="/baby/quick/feed" className="btn btn-primary btn-lg">
              Breastfeed
            </Link>
          )}
          <Link prefetch={false} href="/baby/log/feed?method=Bottle" className={`btn btn-lg ${breastfeeds ? "" : "btn-primary"}`}>
            Log a bottle
          </Link>
        </div>
      )}
      <FeedDay summary={summary} entries={entries} dayStartMs={Date.parse(dayRange(today, tz).from)} dayEndMs={Date.parse(dayRange(today, tz).to)} timezone={tz} nowIso={new Date().toISOString()} today={today} />
      {lastNight && (lastNight.night_feeds > 0 || lastNight.night_sleep_min > 0) && (
        <section className="card tint-feed flex flex-col gap-1" aria-labelledby="night-feeds-h">
          <h2 id="night-feeds-h" className="section-title">Last night</h2>
          <p className="text-2xl font-bold">
            {lastNight.night_feeds} {lastNight.night_feeds === 1 ? "night feed" : "night feeds"}
          </p>
        </section>
      )}
      <DayEntries entries={feeds} types={summary.types} timezone={tz} today={today} canEdit={can(me, "lana", "edit")} canDelete={can(me, "lana", "delete")} noun={["feed", "feeds"]} />
      {days.length > 0 && (
        <Fold title="The week" icon="bottle" tint="feed" hint={norms ? `usually ${norms.feeds.low} to ${norms.feeds.high} a day` : null}>
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
