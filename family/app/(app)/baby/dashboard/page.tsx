import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EntryRow, HomeSummary, Me, MilkData, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { PumpDashboard } from "@/components/PumpDashboard";
import { SleepDay } from "@/components/SleepDay";
import type { PumpDay } from "@/lib/pumping";
import { nightWindow } from "@/lib/night";
import { addDays, dayRange, todayYmd } from "@/lib/time";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/**
 * The dashboard Mido asked for (3 and 4 November): Lana's sleep today (when she woke,
 * awake since, the naps, the day's sleep path), then Dana's pumping (today against the
 * goal, the bottles at home, the usual day). Reached from Milk, Lana's page and More.
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const [{ data: milkData }, { data: sumData }] = await Promise.all([supabase.rpc("milk_list"), supabase.rpc("home_summary")]);
  const summary = sumData as HomeSummary | RpcError | null;
  const subjectId = summary?.ok ? summary.subject.id : null;
  // Since yesterday evening, like the Milk screen's goal: a night pump counts for the day it feeds.
  const evening = new Date(Date.parse(dayRange(addDays(today, -1), tz).from) + 18 * 3_600_000).toISOString();
  // From 12 hours before the day, so the night she woke from counts (the Today tab does the same).
  const dayFrom = new Date(Date.parse(dayRange(today, tz).from) - 12 * 3_600_000).toISOString();
  const [{ data: histData }, { data: statsData }] = subjectId
    ? await Promise.all([
        supabase.rpc("care_entries_list", { p_subject_id: subjectId, p_from: dayFrom, p_to: new Date(Date.now() + 3_600_000).toISOString() }),
        supabase.rpc("care_daily_stats", { p_subject_id: subjectId, p_from: addDays(today, -7), p_to: today }),
      ])
    : [{ data: null }, { data: null }];
  const entries = ((histData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
  const pumps = entries.filter((e) => e.type_id === "lana.pump" && e.occurred_at >= evening);
  const showPump = !!me.member.breastfeeds || me.role.id === "admin";
  const days = (((statsData as { ok?: boolean; days?: PumpDay[] } | null)?.days ?? []) as PumpDay[]).map((d) => ({ day: d.day, pump_ml: Number(d.pump_ml) || 0 }));
  const milk = milkData as MilkData | RpcError | null;
  const hourOfDay = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/baby" title="Dashboard" />
      {summary?.ok && <SleepDay entries={entries} day={today} timezone={tz} nowIso={new Date().toISOString()} night={nightWindow(summary.subject.settings)} />}
      {showPump && <PumpDashboard pumps={pumps} milk={milk && milk.ok ? milk : null} target={me.household.milk_target_ml ?? 400} days={days} today={today} hourOfDay={hourOfDay} />}
      {showPump && can(me, "lana", "add") && (
        <div className="bottom-action">
          <Link prefetch={false} href="/baby/log/pump" className="btn btn-primary btn-lg">
            Log a pump
          </Link>
        </div>
      )}
    </div>
  );
}
