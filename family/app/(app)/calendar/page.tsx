import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CalendarData, Me, Member, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, todayYmd } from "@/lib/time";
import { CalendarView } from "@/components/CalendarView";

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
  const [{ data: cal }, { data: members }] = await Promise.all([
    supabase.rpc("calendar_list", { p_from: from, p_to: to }),
    supabase.from("members").select("id, display_name").eq("is_active", true).order("display_name"),
  ]);
  const data = cal as CalendarData | RpcError;
  if (!data.ok) redirect("/");
  return (
    <CalendarView
      data={data}
      from={from}
      today={today}
      members={((members as Pick<Member, "id" | "display_name">[]) ?? []).map((m) => ({ id: m.id, name: m.display_name }))}
    />
  );
}
