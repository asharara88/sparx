import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DayStats, EntryRow, HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, dayRange, fmtDuration, todayYmd } from "@/lib/time";
import { meOnce } from "@/lib/server/me";
import { PageHeader } from "@/components/PageHeader";
import { QuickSleep } from "@/components/QuickSleep";
import { SleepDay } from "@/components/SleepDay";
import { DayEntries } from "@/components/DayEntries";
import { Fold } from "@/components/Fold";
import { nightWindow } from "@/lib/night";
import { range, stageFor } from "@/lib/stage";
import { dayLabel } from "@/lib/by-day";

export const dynamic = "force-dynamic";

/**
 * Sleep, all of it in one place (Mido, 7 November): reached from every lilac card. Now (the
 * big button, or it already happened with the time typed), today's bar, last night, every
 * sleep of the week to fix or delete, and the week's naps and nights against what is usual
 * at her age.
 */
export default async function SleepPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
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
  const days = (((statsData as { days?: DayStats[] } | null)?.days ?? []) as DayStats[]).filter((d) => d.day < today);
  const lastNight = days.find((d) => d.day === addDays(today, -1));
  const stage = stageFor(summary.subject.birth_date, Date.now(), tz);
  const asleep = summary.ongoing.find((e) => e.type_id === sleepType.id) ?? null;
  const name = summary.subject.name;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/" title="Sleep" subtitle={asleep ? `${name} is asleep.` : `${name} is awake.`} />
      {can(me, "lana", "add") && <QuickSleep subjectId={summary.subject.id} typeId={sleepType.id} asleep={asleep} timezone={tz} />}
      <SleepDay entries={entries} day={today} timezone={tz} nowIso={new Date().toISOString()} night={nightWindow(summary.subject.settings)} usualNaps={stage.naps} />
      {lastNight && lastNight.night_sleep_min > 0 && (
        <section className="card tint-sleep flex flex-col gap-1" aria-labelledby="last-night-h">
          <h2 id="last-night-h" className="section-title">Last night</h2>
          <p className="text-2xl font-bold">{fmtDuration(lastNight.night_sleep_min)} of sleep</p>
          <p className="text-sm">
            Longest stretch {fmtDuration(lastNight.longest_stretch_min)} · {lastNight.night_wakes} {lastNight.night_wakes === 1 ? "wake-up" : "wake-ups"} · {lastNight.night_feeds} {lastNight.night_feeds === 1 ? "night feed" : "night feeds"}
          </p>
        </section>
      )}
      <DayEntries entries={sleeps} types={summary.types} timezone={tz} today={today} canEdit={can(me, "lana", "edit")} canDelete={can(me, "lana", "delete")} tint="sleep" noun={["sleep", "sleeps"]} />
      {days.length > 0 && (
        <Fold title="The week" icon="moon" tint="sleep" hint={`usually ${range(stage.naps)} naps`}>
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
