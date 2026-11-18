import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DailyStats, EntryRow, HomeSummary, Me, RpcError, VaccinesData } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, dayRange, describePayload, fmtDate, fmtDuration, fmtTime, minutesBetween, todayYmd } from "@/lib/time";
import { ageDays, ageWords, averagesLine, dayAverages, type AverageKey } from "@/lib/norms";
import { isToddler } from "@/lib/stage";
import { PrintButton } from "@/components/PrintButton";
import { PageHeader } from "@/components/PageHeader";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/**
 * The child's log for the paediatrician: a printable page (Share → Print → Save as PDF on
 * the phone). Daily totals for the range, growth, firsts, and the day-by-day entries
 * when the range is two weeks or less. Averages count only the days each kind was logged
 * (lib/norms, X8); from 12 months a kind the family does not log is left out (R8).
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
    // From the day before the range: a toddler's first night counts only beside the night before it.
    supabase.rpc("care_daily_stats", { p_subject_id: s.id, p_from: addDays(from, -1), p_to: to }),
    days <= 14 ? supabase.rpc("care_entries_list", { p_subject_id: s.id, p_from: dayRange(from, tz).from, p_to: dayRange(to, tz).to }) : Promise.resolve({ data: null }),
    supabase.rpc("vaccines_list", { p_subject_id: s.id }),
  ]);
  const vax = vaxData as VaccinesData | RpcError | null;
  const vaccines = vax?.ok ? vax.items.filter((v) => v.status !== "upcoming") : [];
  const stats = statsData as DailyStats | RpcError;
  const fetched = stats.ok ? stats.days : [];
  const rows = fetched.filter((r) => r.day >= from);
  const entries = ((listData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
  const ageWeeks = s.birth_date ? Math.floor((new Date(to).getTime() - new Date(s.birth_date).getTime()) / (7 * 86400000)) : null;
  const toddler = !!s.birth_date && isToddler(ageDays(s.birth_date, to));
  // A baby's printout says the age in weeks, as always; a toddler's in months and years (X7).
  const ageAt = s.birth_date && toddler ? ageWords(s.birth_date, to) : ageWeeks != null ? `${ageWeeks} weeks` : null;
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const averages = dayAverages(rows, fetched.find((r) => r.day === addDays(from, -1)) ?? null, toddler);
  const avg = (k: AverageKey) => Math.round(averages.mean(k));
  // What a baby's printout always lists; from 12 months only the kinds logged in the range.
  // Sleep is listed whenever any was logged; its average needs two nights in a row for a toddler (R3),
  // so before that it is taken over the days with any sleep, never printed as 0.
  const sleepRows = rows.filter((r) => r.sleep_min + r.night_sleep_min > 0);
  const show = { feed: !toddler || averages.logged.feed, diaper: !toddler || averages.logged.diaper, sleep: !toddler || sleepRows.length > 0 };
  const avgSleep = (k: AverageKey) => (toddler && averages.counted.sleep === 0 ? Math.round(sleepRows.reduce((a, r) => a + (Number(r[k]) || 0), 0) / Math.max(1, sleepRows.length)) : avg(k));
  const growth = rows.filter((r) => r.weight_kg || r.length_cm || r.head_cm);
  const firsts = rows.flatMap((r) => r.milestones.map((m) => ({ day: r.day, m })));
  const byDay = new Map<string, EntryRow[]>();
  for (const e of entries) {
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(e.occurred_at));
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }
  // Seven days is the child's Week tab; the doctor's printout starts at two weeks.
  const ranges = [
    { label: "2 weeks", from: addDays(today, -13) },
    { label: "4 weeks", from: addDays(today, -27) },
    { label: "3 months", from: addDays(today, -90) },
  ];

  return (
    <div className="flex flex-col gap-4 print:gap-2">
      {/* The screen: a title like its siblings, the range as one control, Save as PDF at the thumb.
          The printout below keeps everything; the long tables print but do not fill the phone. */}
      <div className="no-print flex flex-col gap-3">
        <PageHeader back="/baby?tab=about" title="For the doctor" subtitle={`${s.name} · the printout for the paediatrician`} />
        <nav className="segmented" aria-label="How far back">
          {ranges.map((r) => (
            <Link prefetch={false} key={r.label} href={`/baby/export?from=${r.from}&to=${today}`} aria-current={from === r.from && to === today ? "page" : undefined}>
              {r.label}
            </Link>
          ))}
        </nav>
        <p className="muted px-1">
          The printout has {s.name}&apos;s averages per day, growth, vaccines, every day and every entry for these {days} days, ready for the clinic.
        </p>
      </div>

      {/* The printout itself: tables suit paper, not a phone, so they appear only when printed. */}
      <section className="print-page hidden print:block">
        <h1 className="page-title">
          {s.name}
          {s.birth_date ? ` · born ${fmtDate(s.birth_date, tz, { day: "numeric", month: "long", year: "numeric" })}` : ""}
          {ageAt != null ? ` · ${ageAt}` : ""}
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

        {(show.feed || show.sleep || show.diaper) && <>
        <h2 className="mt-4 text-lg font-bold">Averages per day</h2>
        {averagesLine(averages, `in these ${days} days`) && <p className="muted text-sm">{averagesLine(averages, `in these ${days} days`)}</p>}
        <table className="mt-1 w-full text-sm">
          <tbody>
            {show.feed && <tr><td>Feeds</td><td className="text-right font-semibold">{avg("breast_count") + avg("bottle_count")} ({avg("breast_count")} breast · {avg("bottle_count")} bottle, {avg("bottle_ml")} ml)</td></tr>}
            {show.feed && <tr><td>Breast minutes</td><td className="text-right font-semibold">{avg("breast_min")} min (L {sum("left_count")} · R {sum("right_count")} over the period)</td></tr>}
            {show.sleep && <tr><td>Sleep</td><td className="text-right font-semibold">{fmtDuration(avgSleep("sleep_min"))} (night {fmtDuration(avgSleep("night_sleep_min"))}, longest stretch {fmtDuration(avgSleep("longest_stretch_min"))}, {avgSleep("nap_count")} naps)</td></tr>}
            {show.sleep && (show.feed ? <tr><td>Night wake-ups / night feeds</td><td className="text-right font-semibold">{avgSleep("night_wakes")} / {avg("night_feeds")}</td></tr> : <tr><td>Night wake-ups</td><td className="text-right font-semibold">{avgSleep("night_wakes")}</td></tr>)}
            {show.diaper && <tr><td>Diapers</td><td className="text-right font-semibold">{avg("diapers")} ({avg("diapers_wet")} wet · {avg("diapers_dirty")} dirty)</td></tr>}
          </tbody>
        </table>
        </>}

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
                    {/* A dose whose window closed before the family joined is not recorded here, never "due" (R12). */}
                    <td>{v.given ? v.given.given_on : v.status === "overdue" ? "overdue" : v.status === "earlier" ? "not recorded" : v.due_on ? `due ${v.due_on}` : ""}</td>
                    <td>{v.given?.place ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h2 className="mt-4 text-lg font-bold">Day by day</h2>
        <table className="mt-1 w-full text-xs">
          <thead><tr className="text-left"><th>Day</th>{show.feed && <><th>Feeds</th><th>ml</th></>}{show.sleep && <><th>Sleep</th><th>Night</th><th>Wakes</th></>}{show.diaper && <th>Diapers</th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day}>
                <td>{r.day.slice(5)}</td>{show.feed && <><td>{r.breast_count + r.bottle_count}</td><td>{r.bottle_ml || ""}</td></>}{show.sleep && <><td>{fmtDuration(r.sleep_min)}</td><td>{fmtDuration(r.night_sleep_min)}</td><td>{r.night_wakes}</td></>}{show.diaper && <td>{r.diapers}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {entries.length > 0 && (
        <section className="print-page hidden print:block">
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
      <div className="bottom-action no-print">
        <PrintButton label="Save as PDF" className="btn btn-primary btn-lg w-full" />
      </div>
    </div>
  );
}
