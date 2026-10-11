import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CalendarData, Me, Member, RpcError, Suggestion } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, todayYmd } from "@/lib/time";
import { CalendarView } from "@/components/CalendarView";
import { PlanButton } from "@/components/PlanButton";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "calendar", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const { d } = await searchParams;
  const from = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today;
  const to = addDays(from, 13);
  const [{ data: cal }, { data: members }, { data: sugData }] = await Promise.all([
    supabase.rpc("calendar_list", { p_from: from, p_to: to }),
    supabase.from("members").select("id, display_name").eq("is_active", true).order("display_name"),
    supabase.rpc("suggestions_list"),
  ]);
  const plan = (((sugData as { suggestions?: Suggestion[] } | null)?.suggestions ?? []) as Suggestion[]).find((s) => s.kind === "plan") ?? null;
  const canPlan = can(me, "calendar", "add") && can(me, "assistant", "view");
  const data = cal as CalendarData | RpcError;
  if (!data.ok) redirect("/");
  return (
    <div className="flex flex-col gap-4">
      {canPlan && <PlanButton existing={plan} />}
    <CalendarView
      data={data}
      from={from}
      today={today}
      members={((members as Pick<Member, "id" | "display_name">[]) ?? []).map((m) => ({ id: m.id, name: m.display_name }))}
    />
    </div>
  );
}
