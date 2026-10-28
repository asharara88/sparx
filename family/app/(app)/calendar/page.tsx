import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CalendarData, DueItem, EntryRow, HomeSummary, Me, Member, RpcError, Suggestion } from "@/lib/types";
import { can } from "@/lib/types";
import { childName } from "@/lib/names";
import { addDays, todayYmd } from "@/lib/time";
import { CalendarView } from "@/components/CalendarView";
import { PlanButton } from "@/components/PlanButton";
import { LanaForecast } from "@/components/LanaForecast";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "calendar", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const { d } = await searchParams;
  const from = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today;
  const to = addDays(from, 13);
  const [{ data: cal }, { data: members }, { data: sugData }, { data: dueData }] = await Promise.all([
    supabase.rpc("calendar_list", { p_from: from, p_to: to }),
    supabase.from("members").select("id, display_name").eq("is_active", true).order("display_name"),
    supabase.rpc("suggestions_list"),
    can(me, "lana", "view") ? supabase.rpc("care_due_list", { p_days_ahead: Math.max(14, Math.round((new Date(to).getTime() - new Date(today).getTime()) / 86400000) + 1) }) : Promise.resolve({ data: null }),
  ]);
  const due = ((dueData as { items?: DueItem[] } | null)?.items ?? []).filter((d) => d.kind === "treatment" || d.kind === "vaccine");
  const plan = (((sugData as { suggestions?: Suggestion[] } | null)?.suggestions ?? []) as Suggestion[]).find((s) => s.kind === "plan") ?? null;
  const canPlan = can(me, "calendar", "add") && can(me, "assistant", "view");
  const data = cal as CalendarData | RpcError;
  if (!data.ok) redirect("/");
  // The child's expected feeds, nappies and naps for the rest of today, from the log.
  let week: EntryRow[] | null = null;
  let feedInterval = 180;
  if (from === today && can(me, "lana", "view")) {
    const { data: sumData } = await supabase.rpc("home_summary");
    const summary = sumData as HomeSummary | RpcError | null;
    if (summary && summary.ok) {
      feedInterval = summary.types.find((t) => t.id === "lana.feed")?.due_after_min ?? 180;
      const { data: weekData } = await supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: new Date(Date.now() - 7 * 86_400_000).toISOString(), p_to: new Date(Date.now() + 3_600_000).toISOString() });
      week = ((weekData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
    }
  }
  return (
    <div className="flex flex-col gap-4">
      {canPlan && <PlanButton existing={plan} />}
      {week && <LanaForecast entries={week} timezone={tz} feedIntervalMin={feedInterval} hours={8} limit={4} title={`${childName(me)}, expected today`} compact />}
    <CalendarView
      data={data}
      from={from}
      today={today}
      members={((members as Pick<Member, "id" | "display_name">[]) ?? []).map((m) => ({ id: m.id, name: m.display_name }))}
      due={due}
    />
    </div>
  );
}
