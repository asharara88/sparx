import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DayStats, EntryRow, HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, dayRange, fmtDuration, todayYmd } from "@/lib/time";
import { meOnce } from "@/lib/server/me";
import { PageHeader } from "@/components/PageHeader";
import { SleepDay } from "@/components/SleepDay";
import { EntryList } from "@/components/EntryList";
import { DayPager } from "@/components/DayPager";
import { SectionSwitch } from "@/components/SectionSwitch";
import { LanaNow } from "@/components/LanaNow";
import { dayNav } from "@/lib/day-nav";
import { Fold } from "@/components/Fold";
import { nightWindow } from "@/lib/night";
import { range, stageFor } from "@/lib/stage";
import { dayLabel } from "@/lib/by-day";
import { ageDays } from "@/lib/norms";
import { napPattern } from "@/lib/child-insights";
import { dayFacts, dayPlan, readDay } from "@/lib/day";

export const dynamic = "force-dynamic";

/**
 * Sleep, one day at a time (DESIGN.md, "The Sleep and Feeds sections"; redrawn 24 November,
 * the same frame as Feeds). Under the title, Feeds | Sleep crosses to the other section. Then,
 * on today, the Sleep timer: the big round button and "or it already happened" with the
 * latest times, which is Home's own timer drawn on the screen (until now this screen had a
 * second one, with other words). Then the day: the pager, the day's card (what she is doing
 * or when she got up, the bar with the feeds as thin marks, the sums, the night before) and
 * that day's sleeps to fix or delete. Last, the week's naps and nights against what is usual.
 * A day before today has no timer: it is for reading and fixing.
 * From 12 months, once a parent has said how many naps a day ("{Name}'s day", lib/day.ts),
 * the usual naps are that answer and not the age's.
 */
export default async function SleepPage({ searchParams }: { searchParams: Promise<{ day?: string | string[] }> }) {
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
  const sleepType = summary.types.find((t) => t.key === "sleep");
  if (!sleepType) redirect("/baby");
  const from = new Date(Date.parse(dayRange(addDays(today, -6), tz).from) - 12 * 3_600_000).toISOString();
  const [{ data: listData }, { data: statsData }] = await Promise.all([
    supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: from, p_to: new Date(Date.now() + 3_600_000).toISOString() }),
    supabase.rpc("care_daily_stats", { p_subject_id: summary.subject.id, p_from: addDays(today, -7), p_to: today }),
  ]);
  const entries = ((listData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
  const sleeps = entries.filter((e) => e.type_id === sleepType.id || e.type_id === "lana.wake").filter((e) => Date.parse(e.occurred_at) >= Date.parse(dayRange(addDays(today, -6), tz).from));
  const stats = ((statsData as { days?: DayStats[] } | null)?.days ?? []) as DayStats[];
  const days = stats.filter((d) => d.day < today);
  // The night that ended on the morning of the day shown.
  const nightBefore = stats.find((d) => d.day === addDays(nav.day, -1));
  const stage = stageFor(summary.subject.birth_date, Date.now(), tz);
  // The family's day, when one is saved and counts at this age; with none the usual naps are the stage's, as before.
  // Only the naps are read from the plan here: the page does not read the milk stash.
  const now = Date.now();
  const age = summary.subject.birth_date ? ageDays(summary.subject.birth_date, today) : null;
  const day = readDay(summary.subject.settings, age, summary.subject.birth_date);
  const pattern = napPattern(entries, age, now, tz, now - 7 * 86_400_000, day?.naps ?? null);
  const { usualNaps: saidNaps, napsSaid } = dayPlan(day, age, dayFacts(summary, { now, today, tz, breastfeeds: !!me.member.breastfeeds, inStock: false, week: entries, pattern }));
  const usualNaps = saidNaps ?? stage.naps;

  const span = dayRange(nav.day, tz);
  const [dayFrom, dayTo] = [Date.parse(span.from), Date.parse(span.to)];
  // A sleep belongs to the day it began on, as the lists here always had it.
  const daySleeps = sleeps.filter((e) => Date.parse(e.occurred_at) >= dayFrom && Date.parse(e.occurred_at) < dayTo).sort((x, y) => Date.parse(y.occurred_at) - Date.parse(x.occurred_at));
  const nowIso = new Date(now).toISOString();
  const night =
    nightBefore && nightBefore.night_sleep_min > 0
      ? `${nav.isToday ? "Last night" : "The night before"}: ${fmtDuration(nightBefore.night_sleep_min)} · longest ${fmtDuration(nightBefore.longest_stretch_min)}${nightBefore.night_wakes > 0 ? ` · ${nightBefore.night_wakes} ${nightBefore.night_wakes === 1 ? "wake-up" : "wake-ups"}` : ""}`
      : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/" title="Sleep" />
      <SectionSwitch current="sleep" day={nav.day} today={today} />
      {can(me, "lana", "add") && nav.isToday && (
        <LanaNow section="sleep" subject={summary.subject} types={summary.types} ongoing={summary.ongoing} recent={entries} timezone={tz} clockIso={nowIso} defaultMilk={null} lastFeedMethod={null} />
      )}
      <DayPager base="/baby/sleep" nav={nav} today={today} />
      <SleepDay entries={entries} day={nav.day} timezone={tz} nowIso={nav.isToday ? nowIso : undefined} night={nightWindow(summary.subject.settings)} usualNaps={usualNaps} section={{ night }} />
      {daySleeps.length > 0 ? (
        <EntryList entries={daySleeps} types={summary.types} timezone={tz} canEdit={can(me, "lana", "edit")} canDelete={can(me, "lana", "delete")} running={summary.ongoing.map((e) => e.id)} />
      ) : (
        <p className="muted px-1 text-sm">{nav.isToday ? "None logged yet today." : "None logged that day."}</p>
      )}
      {days.length > 0 && (
        // A family that says no nap is not told what is usual.
        <Fold title="The week" icon="moon" tint="sleep" hint={napsSaid === 0 ? null : `usually ${range(usualNaps)} ${usualNaps[1] === 1 && usualNaps[0] === 1 ? "nap" : "naps"}`}>
          <ul className="flex flex-col">
            {[...days].reverse().map((d) => (
              <li key={d.day} className="row">
                <span className="w-24 shrink-0 font-semibold">{dayLabel(d.day, today)}</span>
                <span className="muted min-w-0 flex-1 text-sm">
                  {d.nap_count} {d.nap_count === 1 ? "nap" : "naps"} · night {fmtDuration(d.night_sleep_min)} · {fmtDuration(d.sleep_min)} in all
                </span>
              </li>
            ))}
          </ul>
        </Fold>
      )}
    </div>
  );
}
