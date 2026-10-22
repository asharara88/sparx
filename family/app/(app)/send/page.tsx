import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceData, CalendarData, Me, RpcError } from "@/lib/types";
import { EVENT_KINDS, can } from "@/lib/types";
import { addDays, fmtTime, todayYmd } from "@/lib/time";
import { AttendanceButton } from "@/components/AttendanceButton";

export const dynamic = "force-dynamic";

/** The screen for someone without the child's log (staff who clock in): the attendance button and today's events that affect them. */
export default async function TodayPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const [{ data: cal }, { data: att }] = await Promise.all([
    can(me, "calendar", "view") ? supabase.rpc("calendar_list", { p_from: today, p_to: addDays(today, 1) }) : Promise.resolve({ data: null }),
    supabase.rpc("attendance_today"),
  ]);
  const attendance = att as AttendanceData | RpcError | null;
  const calendar = cal as CalendarData | RpcError | null;
  const todays = calendar && calendar.ok ? calendar.events.filter((e) => e.date === today) : [];
  return (
    <div className="flex flex-col gap-4">
      <header className="page-header page-header-large">
        <h1 className="page-title">Today</h1>
      </header>
      <AttendanceButton open={attendance && attendance.ok ? (attendance.open.find((o) => o.member_id === me.member.id) ?? null) : null} timezone={tz} />
      {calendar && calendar.ok && (
        <section className="card">
          <h2 className="text-xl font-bold">Today at home</h2>
          {todays.length === 0 ? (
            <p className="muted mt-1">Nothing planned today.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {todays.map((e) => (
                <li key={e.id + e.starts_at}>
                  <span aria-hidden>{EVENT_KINDS.find((k) => k.id === e.kind)?.icon} </span>
                  {e.all_day ? "All day" : fmtTime(e.starts_at, tz)} · {e.title}
                  {e.note ? ` · ${e.note}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
