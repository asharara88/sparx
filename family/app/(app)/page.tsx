import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { HomeSummary, HouseholdToday, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { fmtDate } from "@/lib/time";
import { LanaCard } from "@/components/LanaCard";
import { HouseholdCard } from "@/components/HouseholdCard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const [{ data: meData }, { data: hhData }] = await Promise.all([supabase.rpc("me"), supabase.rpc("household_today")]);
  const me = meData as Me;
  const household = hhData as HouseholdToday | RpcError;
  const tz = me.household.timezone;
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  let summary: HomeSummary | RpcError | null = null;
  if (can(me, "lana", "view")) {
    const { data } = await supabase.rpc("home_summary");
    summary = data as HomeSummary | RpcError;
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="pt-2">
        <p className="muted">{fmtDate(now.toISOString(), tz, { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="text-3xl font-bold">
          {greeting}, {me.member.display_name}
        </h1>
      </header>

      {summary && summary.ok && <LanaCard summary={summary} />}
      {summary && !summary.ok && (
        <div className="card">
          <p>{summary.message}</p>
        </div>
      )}

      {household.ok && <HouseholdCard data={household} me={me} />}

      {me.role.id === "home_carer" && (
        <div className="card">
          <h2 className="text-xl font-semibold">Your work days</h2>
          <p className="mt-1">
            {me.work_days.length ? me.work_days.map((d) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d]).join(", ") : "Not set yet."}
          </p>
          <p className="muted mt-3">Shopping requests and repair tickets will appear here in the next step.</p>
        </div>
      )}

      {can(me, "audit", "view") && (
        <Link href="/audit" className="btn">
          Audit log
        </Link>
      )}
    </div>
  );
}
