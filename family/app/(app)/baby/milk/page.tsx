import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, MilkData, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { MilkStash } from "@/components/MilkStash";
import { PageHeader } from "@/components/PageHeader";
import { FridgePlan } from "@/components/FridgePlan";
import { MilkScan } from "@/components/MilkScan";
import { MilkInsights } from "@/components/MilkInsights";
import type { EntryRow, HomeSummary, HouseholdToday } from "@/lib/types";
import { WORK_FROM, WORK_TO, hhmm } from "@/lib/household";
import { addDays, dayRange, todayYmd } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function MilkPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const [{ data }, { data: hhData }, { data: sumData }] = await Promise.all([supabase.rpc("milk_list"), supabase.rpc("household_today"), supabase.rpc("home_summary")]);
  const subjectId = (sumData as HomeSummary | RpcError | null)?.ok ? (sumData as HomeSummary).subject.id : null;
  const { data: histData } = subjectId ? await supabase.rpc("care_entries_list", { p_subject_id: subjectId, p_from: new Date(Date.now() - 14 * 86_400_000).toISOString(), p_to: new Date(Date.now() + 3_600_000).toISOString() }) : { data: null };
  const history = ((histData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
  const milk = data as MilkData | RpcError;
  if (!milk.ok) redirect("/");
  const hh = hhData as HouseholdToday | RpcError;
  const summary = sumData as HomeSummary | RpcError;
  const mama = hh.ok ? hh.members.find((m) => m.breastfeeds) ?? null : null;
  const now = new Date();
  const hhm = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: tz }).format(now).replace(":", ""));
  const from = hhmm(mama?.work_from, WORK_FROM);
  const to = hhmm(mama?.work_to, WORK_TO);
  const away = !!mama && mama.works_today && hhm >= from && hhm <= to;
  const dayStart = Date.parse(dayRange(today, tz).from);
  const backAt = new Date(dayStart + (Math.floor(to / 100) * 60 + (to % 100)) * 60_000).toISOString();
  const awayTomorrow = !!mama && mama.work_days.includes(new Date(Date.parse(dayRange(addDays(today, 1), tz).from) + 12 * 3_600_000).getUTCDay());
  const thaw = { awayTomorrow, awayMinutes: (Math.floor(to / 100) * 60 + (to % 100)) - (Math.floor(from / 100) * 60 + (from % 100)), intervalMin: milk.bottle_interval_min, hour: Math.floor(hhm / 100) };
  let lastBottleMl = 120;
  let lastFeedAt: string | null = null;
  if (summary.ok) {
    lastFeedAt = summary.last["lana.feed"]?.ended_at ?? summary.last["lana.feed"]?.occurred_at ?? null;
    const b = summary.today_entries.find((e: EntryRow) => e.type_id === "lana.feed" && e.payload.method === "Bottle");
    if (b && Number(b.payload.amount_ml)) lastBottleMl = Number(b.payload.amount_ml);
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/baby" title="Milk stash" subtitle="What is in the fridge and freezer, oldest first. A bottle feed takes its milk out by itself." />
      {can(me, "lana", "add") && <MilkScan timezone={tz} />}
      {away && <FridgePlan milk={milk} lastFeedAt={lastFeedAt} backAtIso={backAt} bottleMl={lastBottleMl} timezone={tz} />}
      <MilkStash data={milk} timezone={me.household.timezone} />
      <MilkInsights milk={milk} entries={history} timezone={tz} thaw={thaw} />
    </div>
  );
}
