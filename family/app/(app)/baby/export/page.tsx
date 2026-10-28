import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DailyStats, EntryRow, HomeSummary, Me, RpcError, VaccinesData } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, dayRange, describePayload, fmtDate, fmtDuration, fmtTime, minutesBetween, todayYmd } from "@/lib/time";
import { PrintButton } from "@/components/PrintButton";
import { Icon } from "@/components/Icon";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/**
 * The child's log for the paediatrician: a printable page (Share → Print → Save as PDF on
 * the phone). Daily totals for the range, growth, firsts, and the day-by-day entries
 * when the range is two weeks or less.
 */
export default async function LanaExportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const sp = await searchParams;
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today;
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) && sp.from <= to ? sp.from : addDays(to, -13);
  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;

  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/baby");
  const s = summary.subject;
  const pf = (s.profile ?? {}) as Record<string, string | undefined>;
  const [{ data: statsData }, { data: listData }, { data: vaxData }] = await Promise.all([
    supabase.rpc("care_daily_stats", { p_subject_id: s.id, p_from: from, p_to: to }),
    days <= 14 ? supabase.rpc("care_entries_list", { p_subject_id: s.id, p_from: dayRange(from, tz).from, p_to: dayRange(to, tz).to }) : Promise.resolve({ data: null }),
    supabase.rpc("vaccines_list", { p_subject_id: s.id }),
  ]);
  const vax = vaxData as VaccinesData | RpcError | null;
  const vaccines = vax?.ok ? vax.items.filter((v) => v.status !== "upcoming") : [];
  const stats = statsData as DailyStats | RpcError;
  const rows = stats.ok ? stats.days : [];
  const entries = ((listData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
  const ageWeeks = s.birth_date ? Math.floor((new Date(to).getTime() - new Date(s.birth_date).getTime()) / (7 * 86400000)) : null;
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const avg = (k: keyof (typeof rows)[number]) => (rows.length ? Math.round(sum(k) / rows.length) : 0);
  const growth = rows.filter((r) => r.weight_kg || r.length_cm || r.head_cm);
  const firsts = rows.flatMap((r) => r.milestones.map((m) => ({ day: r.day, m })));
  const byDay = new Map<string, EntryRow[]>();
  for (const e of entries) {
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(e.occurred_at));
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }
  const ranges = [
    { label: "7 days", from: addDays(today, -6) },
    { label: "2 weeks", from: addDays(today, -13) },
    { label: "4 weeks", from: addDays(today, -27) },
    { label: "3 months", from: addDays(today, -90) },
  ];

  return (
    <div className="flex flex-col gap-4 print:gap-2">
      <header className="page-header no-print flex items-center justify-between gap-2">
        <Link href="/baby/trends" className="icon-btn" aria-label="Back">
          <Icon name="back" size={24} />
        </Link>
        <div className="flex flex-wrap gap-2">
          {ranges.map((r) => (
            <Link key={r.label} href={`/baby/export?from=${r.from}&to=${today}`} className="chip" aria-pressed={from === r.from && to === today}>
              {r.label}
            </Link>
          ))}
        </div>
      </header>
      <div className="no-print">
        <PrintButton label="Print or save as PDF for the paediatrician" />
        <p className="muted mt-1 text-sm">On the phone: tap the button, then “Save as PDF” or share it straight to the clinic.</p>
      </div>

      <section className="print-page">
        <h1 className="page-title">
          {s.name}
          {s.birth_date ? ` · born ${fmtDate(s.birth_date, tz, { day: "numeric", month: "long", year: "numeric" })}` : ""}
          {ageWeeks != null ? ` · ${ageWeeks} weeks` : ""}
        </h1>
        <p className="muted">
          {fmtDate(from, tz, { day: "numeric", month: "long" })} to {fmtDate(to, tz, { day: "numeric", month: "long", year: "numeric" })} · {days} days · from the family's log, {me.household.name}
        </p>

        {(pf.blood_group || pf.allergies || pf.hospital_number) && (
          <p className="muted text-sm">
            {[pf.blood_group ? `Blood group ${pf.blood_group}` : null, pf.allergies ? `Allergies: ${pf.allergies}` : null, pf.hospital_number ? `File ${pf.hospital_number}` : null, pf.birth_weight_kg ? `Born ${pf.birth_weight_kg} kg, ${pf.birth_length_cm ?? "?"} cm` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}

        <h2 className="mt-4 text-lg font-bold">Averages per day</h2>
        <table className="mt-1 w-full text-sm">
          <tbody>
            <tr><td>Feeds</td><td className="text-right font-semibold">{avg("breast_count") + avg("bottle_count")} ({avg("breast_count")} breast · {avg("bottle_count")} bottle, {avg("bottle_ml")} ml)</td></tr>
            <tr><td>Breast minutes</td><td className="text-right font-semibold">{avg("breast_min")} min (L {sum("left_count")} · R {sum("right_count")} over the period)</td></tr>
            <tr><td>Sleep</td><td className="text-right font-semibold">{fmtDuration(avg("sleep_min"))} (night {fmtDuration(avg("night_sleep_min"))}, longest stretch {fmtDuration(avg("longest_stretch_min"))}, {avg("nap_count")} naps)</td></tr>
            <tr><td>Night wake-ups / night feeds</td><td className="text-right font-semibold">{avg("night_wakes")} / {avg("night_feeds")}</td></tr>
            <tr><td>Diapers</td><td className="text-right font-semibold">{avg("diapers")} ({avg("diapers_wet")} wet · {avg("diapers_dirty")} dirty)</td></tr>
          </tbody>
        </table>

        {growth.length > 0 && (
          <>
            <h2 className="mt-4 text-lg font-bold">Growth</h2>
            <table className="mt-1 w-full text-sm">
              <thead><tr className="text-left"><th>Date</th><th>Weight</th><th>Length</th><th>Head</th></tr></thead>
              <tbody>
                {growth.map((r) => (
                  <tr key={r.day}><td>{r.day}</td><td>{r.weight_kg ? `${r.weight_kg} kg` : ""}</td><td>{r.length_cm ? `${r.length_cm} cm` : ""}</td><td>{r.head_cm ? `${r.head_cm} cm` : ""}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {firsts.length > 0 && (
          <>
            <h2 className="mt-4 text-lg font-bold">Firsts</h2>
            <ul className="mt-1 text-sm">{firsts.map((f, i) => <li key={i}>{f.day} · {f.m}</li>)}</ul>
          </>
        )}

        {vaccines.length > 0 && (
          <>
            <h2 className="mt-4 text-lg font-bold">Vaccines</h2>
            <table className="mt-1 w-full text-sm">
              <thead><tr className="text-left"><th>Visit</th><th>Vaccine</th><th>Given</th><th>Where</th></tr></thead>
              <tbody>
                {vaccines.map((v) => (
                  <tr key={v.id}>
                    <td>{v.visit}</td><td>{v.vaccine} ({v.dose})</td>
                    <td>{v.given ? v.given.given_on : v.status === "overdue" ? "overdue" : v.due_on ? `due ${v.due_on}` : ""}</td>
                    <td>{v.given?.place ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h2 className="mt-4 text-lg font-bold">Day by day</h2>
        <table className="mt-1 w-full text-xs">
          <thead><tr className="text-left"><th>Day</th><th>Feeds</th><th>ml</th><th>Sleep</th><th>Night</th><th>Wakes</th><th>Diapers</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day}>
                <td>{r.day.slice(5)}</td><td>{r.breast_count + r.bottle_count}</td><td>{r.bottle_ml || ""}</td><td>{fmtDuration(r.sleep_min)}</td><td>{fmtDuration(r.night_sleep_min)}</td><td>{r.night_wakes}</td><td>{r.diapers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {entries.length > 0 && (
        <section className="print-page">
          <h2 className="text-lg font-bold">Entries</h2>
          {Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([d, list]) => (
            <div key={d} className="mt-2 break-inside-avoid">
              <h3 className="font-semibold">{fmtDate(d, tz, { weekday: "short", day: "numeric", month: "short" })}</h3>
              <ul className="text-xs">
                {list.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).map((e) => (
                  <li key={e.id}>
                    {fmtTime(e.occurred_at, tz)}
                    {e.ended_at ? `–${fmtTime(e.ended_at, tz)} (${fmtDuration(minutesBetween(e.occurred_at, e.ended_at))})` : ""} {e.type_label}
                    {Object.keys(e.payload).length ? ` · ${describePayload(e.payload)}` : ""}
                    {e.note ? ` · ${e.note}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
