import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CalendarData, EntryRow, HomeSummary, Me, RpcError, VaccinesData } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, dayRange, describePayload, fmtDate, fmtDateTime, todayYmd } from "@/lib/time";
import { ChildCard } from "@/components/ChildCard";
import { DoctorCard } from "@/components/DoctorCard";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function DoctorPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  const s = summary.subject;
  const [{ data: vaxData }, { data: calData }, { data: listData }] = await Promise.all([
    supabase.rpc("vaccines_list", { p_subject_id: s.id }),
    can(me, "calendar", "view") ? supabase.rpc("calendar_list", { p_from: today, p_to: addDays(today, 90) }) : Promise.resolve({ data: null }),
    supabase.rpc("care_entries_list", { p_subject_id: s.id, p_from: dayRange(addDays(today, -365), tz).from, p_to: dayRange(today, tz).to }),
  ]);
  const vax = vaxData as VaccinesData | RpcError | null;
  const nextVisit = vax?.ok ? vax.items.find((v) => v.status === "due" || v.status === "overdue") ?? vax.items.find((v) => v.status === "upcoming") : null;
  const cal = calData as CalendarData | null;
  // Appointments for this child: their name in the title, or a doctor's word.
  const about = new RegExp(`${s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|vaccin|doctor|paed|pedia|clinic`, "i");
  const appointments = (cal?.ok ? cal.events : []).filter((e) => e.kind === "appointment" && about.test(e.title)).slice(0, 5);
  const visits = (((listData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[]).filter((e) => e.type_id === "lana.appointment").slice(0, 8);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back="/baby"
        title={`${s.name} · Paediatrician`}
        action={
          <Link href="/baby/vaccines" className="btn btn-secondary">
            <Icon name="syringe" size={18} /> Vaccines
          </Link>
        }
      />
      <DoctorCard subject={s} canEdit={can(me, "lana", "edit")} />
      <ChildCard subject={s} canEdit={can(me, "lana", "edit")} />

      <section className="card flex flex-col gap-2">
        <h2 className="section-title">Coming up</h2>
        {nextVisit && nextVisit.due_on && (
          <Link href="/baby/vaccines" className="row-link flex items-center gap-3">
            <Icon name="syringe" size={20} className="shrink-0" />
            <span className="flex-1">
              <span className="font-semibold">{nextVisit.visit} vaccines</span>
              <span className="muted block text-sm">
                {nextVisit.status === "overdue" ? "Window closed, book it" : `Due around ${fmtDate(`${nextVisit.due_on}T12:00:00Z`, "UTC", { day: "numeric", month: "long" })}`}
              </span>
            </span>
            <Icon name="forward" size={18} className="muted shrink-0" />
          </Link>
        )}
        {appointments.map((e) => (
          <Link key={e.id} href="/calendar" className="row-link flex items-center gap-3">
            <Icon name="calendar" size={20} className="shrink-0" />
            <span className="flex-1">
              <span className="font-semibold">{e.title}</span>
              <span className="muted block text-sm">{e.all_day ? fmtDate(e.starts_at, tz, { weekday: "long", day: "numeric", month: "long" }) : fmtDateTime(e.starts_at, tz)}</span>
            </span>
            <Icon name="forward" size={18} className="muted shrink-0" />
          </Link>
        ))}
        {!nextVisit && appointments.length === 0 && <p className="muted">Nothing booked.</p>}
      </section>

      <section className="card flex flex-col gap-2">
        <h2 className="section-title">Past visits</h2>
        {visits.length === 0 ? (
          <p className="muted">No visit logged in the last year. Use “Log a visit” after each appointment so the reason and what the doctor said are kept.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--line)]">
            {visits.map((e) => (
              <li key={e.id}>
                <Link href={`/baby/entry/${e.id}`} className="row-link flex items-center gap-3 py-2">
                  <span className="flex-1">
                    <span className="font-semibold">{fmtDate(e.occurred_at, tz, { day: "numeric", month: "short", year: "numeric" })}</span>
                    <span className="muted block text-sm">{[describePayload(e.payload), e.note].filter(Boolean).join(" · ") || "Appointment"}</span>
                  </span>
                  <Icon name="forward" size={18} className="muted shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
