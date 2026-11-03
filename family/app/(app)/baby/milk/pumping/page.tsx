import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EntryRow, HomeSummary, Me, MilkData, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { PumpDashboard } from "@/components/PumpDashboard";
import type { PumpDay } from "@/lib/pumping";
import { addDays, dayRange, todayYmd } from "@/lib/time";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/** Pumping: today against the goal, the bottles at home, the usual day lately. Reached from Milk. */
export default async function PumpingPage() {
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
  const [{ data: histData }, { data: statsData }] = subjectId
    ? await Promise.all([
        supabase.rpc("care_entries_list", { p_subject_id: subjectId, p_from: evening, p_to: new Date(Date.now() + 3_600_000).toISOString() }),
        supabase.rpc("care_daily_stats", { p_subject_id: subjectId, p_from: addDays(today, -7), p_to: today }),
      ])
    : [{ data: null }, { data: null }];
  const pumps = (((histData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[]).filter((e) => e.type_id === "lana.pump");
  const days = (((statsData as { ok?: boolean; days?: PumpDay[] } | null)?.days ?? []) as PumpDay[]).map((d) => ({ day: d.day, pump_ml: Number(d.pump_ml) || 0 }));
  const milk = milkData as MilkData | RpcError | null;
  const hourOfDay = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/baby/milk" title="Pumping" />
      <PumpDashboard pumps={pumps} milk={milk && milk.ok ? milk : null} target={me.household.milk_target_ml ?? 400} days={days} today={today} hourOfDay={hourOfDay} />
      {can(me, "lana", "add") && (
        <div className="bottom-action">
          <Link prefetch={false} href="/baby/log/pump" className="btn btn-primary btn-lg">
            Log a pump
          </Link>
        </div>
      )}
    </div>
  );
}
