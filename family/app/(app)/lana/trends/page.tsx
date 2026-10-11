import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DailyStats, HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, todayYmd } from "@/lib/time";
import { Trends } from "@/components/Trends";

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
  const { data } = await supabase.rpc("care_daily_stats", { p_subject_id: summary.subject.id, p_from: from, p_to: today });
  const stats = data as DailyStats | RpcError;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2 pt-2">
        <h1 className="text-2xl font-bold">{summary.subject.name} · Trends</h1>
        <div className="flex gap-2">
          <Link href="/lana/export" className="btn">
            🖨️ For the doctor
          </Link>
          <Link href="/lana" className="btn">
            Day by day
          </Link>
        </div>
      </header>
      {stats.ok ? (
        <Trends stats={stats} today={today} birthDate={summary.subject.birth_date} />
      ) : (
        <p className="card">{"message" in stats ? stats.message : "Could not load."}</p>
      )}
    </div>
  );
}
