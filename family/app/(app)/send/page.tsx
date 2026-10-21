import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceData, CalendarData, Me, RpcError, ShoppingData, ShoppingRequest } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, todayYmd } from "@/lib/time";
import { SendRequest } from "@/components/SendRequest";
import { AttendanceButton } from "@/components/AttendanceButton";
import Link from "next/link";

export const dynamic = "force-dynamic";

/** The home carer's screen: tap what is running low, or send a photo. Plus today's events that affect them. */
export default async function SendPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "shopping_requests", "add")) redirect("/");
  const today = todayYmd(me.household.timezone);
  const [{ data: list }, { data: mine }, { data: cal }, { data: att }] = await Promise.all([
    supabase.rpc("shopping_list"),
    supabase.rpc("shopping_requests_list", { p_status: null }),
    can(me, "calendar", "view") ? supabase.rpc("calendar_list", { p_from: today, p_to: addDays(today, 1) }) : Promise.resolve({ data: null }),
    supabase.rpc("attendance_today"),
  ]);
  const attendance = att as AttendanceData | RpcError | null;
  const shelf = (list as ShoppingData | RpcError).ok ? (list as ShoppingData).shelf : [];
  const requests = ((mine as { requests?: ShoppingRequest[] })?.requests ?? []).slice(0, 10);
  const calendar = cal as CalendarData | RpcError | null;
  return (
    <div className="flex flex-col gap-4">
      <div className="pt-3">
        <AttendanceButton open={attendance && attendance.ok ? (attendance.open.find((o) => o.member_id === me.member.id) ?? null) : null} timezone={me.household.timezone} />
      </div>
      <SendRequest
        shelf={shelf}
        recent={requests}
        events={calendar && calendar.ok ? calendar.events : []}
        timezone={me.household.timezone}
        today={today}
      />
    </div>
  );
}
