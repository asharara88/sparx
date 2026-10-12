import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DailyStats, EntryRow, HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, dayRange, todayYmd } from "@/lib/time";
import { Trends } from "@/components/Trends";
import { Icon } from "@/components/Icon";
import { PatternBars } from "@/components/PatternBars";

export const dynamic = "force-dynamic";

export default async function LanaTrendsPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  const from = summary.subject.birth_date && summary.subject.birth_date > addDays(today, -365) ? summary.subject.birth_date : addDays(today, -365);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const [{ data }, { data: listData }] = await Promise.all([
    supabase.rpc("care_daily_stats", { p_subject_id: summary.subject.id, p_from: from, p_to: today }),
    supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: dayRange(days[0], tz).from, p_to: dayRange(today, tz).to }),
  ]);
  const stats = data as DailyStats | RpcError;
  const entries = ((listData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];

  return (
    <div className="flex flex-col gap-4">
      <header className="page-header flex items-center justify-between gap-2">
        <h1 className="page-title">{summary.subject.name} · Trends</h1>
        <div className="flex gap-2">
          <Link href="/lana/export" className="btn">
            <Icon name="printer" size={20} /> For the doctor
          </Link>
          <Link href="/lana" className="btn">
            Day by day
          </Link>
        </div>
      </header>
      <PatternBars entries={entries} days={days} timezone={tz} today={today} />
      {stats.ok ? (
        <Trends stats={stats} today={today} birthDate={summary.subject.birth_date} />
      ) : (
        <p className="card">{"message" in stats ? stats.message : "Could not load."}</p>
      )}
    </div>
  );
}
