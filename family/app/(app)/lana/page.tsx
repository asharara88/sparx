import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DailyStats, EntryRow, HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, dayRange, describePayload, fmtDuration, fmtTime, minutesBetween, todayYmd } from "@/lib/time";
import { AgeCheck } from "@/components/AgeCheck";
import { DayStrip } from "@/components/DayStrip";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function LanaDayPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const { d } = await searchParams;
  const day = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today;

  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  const { from, to } = dayRange(day, tz);
  const [{ data: listData }, { data: stripData }, { data: statsData }] = await Promise.all([
    supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: from, p_to: to }),
    supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: new Date(new Date(from).getTime() - 12 * 3600 * 1000).toISOString(), p_to: to }),
    supabase.rpc("care_daily_stats", { p_subject_id: summary.subject.id, p_from: day, p_to: day }),
  ]);
  const stats = statsData as DailyStats | RpcError | null;
  const dayStats = stats?.ok ? stats.days.find((x) => x.day === day) ?? stats.days[0] ?? null : null;
  const entries = ((listData as { ok: boolean; entries?: EntryRow[] })?.entries ?? []) as EntryRow[];
  const stripEntries = ((stripData as { ok: boolean; entries?: EntryRow[] })?.entries ?? []) as EntryRow[];

  const counts = new Map<string, number>();
  let feedMl = 0;
  let sleepMin = 0;
  for (const e of entries) {
    counts.set(e.type_label, (counts.get(e.type_label) ?? 0) + 1);
    if (e.type_id === "lana.feed" && typeof e.payload.amount_ml === "number") feedMl += e.payload.amount_ml;
    if (e.type_id === "lana.sleep" && e.ended_at) sleepMin += minutesBetween(e.occurred_at, e.ended_at);
  }
  const label = day === today ? "Today" : day === addDays(today, -1) ? "Yesterday" : day;

  return (
    <div className="flex flex-col gap-4">
      <header className="page-header flex items-center justify-between gap-2">
        <Link href={`/lana?d=${addDays(day, -1)}`} className="icon-btn" aria-label="Previous day">
          <Icon name="back" size={24} />
        </Link>
        <h1 className="page-title text-center">
          {summary.subject.name} · {label}
        </h1>
        <Link
          href={`/lana?d=${addDays(day, 1)}`}
          className="icon-btn" aria-label="Next day"
          aria-disabled={day >= today}
          style={day >= today ? { visibility: "hidden" } : undefined}>
          <Icon name="forward" size={24} />
        </Link>
      </header>

      <DayStrip entries={stripEntries} day={day} timezone={tz} nowIso={day === today ? new Date().toISOString() : undefined} />
      <p className="text-right text-sm">
        <Link href="/lana/trends" className="underline">
          Trends and growth ›
        </Link>
      </p>

      <div className="card">
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          {[...counts.entries()].map(([k, v]) => (
            <span key={k}>
              <b>{v}</b> {k.toLowerCase()}
              {v === 1 ? "" : "s"}
            </span>
          ))}
          {feedMl > 0 && (
            <span>
              <b>{feedMl} ml</b> bottle
            </span>
          )}
          {sleepMin > 0 && (
            <span>
              <b>{fmtDuration(sleepMin)}</b> sleep
            </span>
          )}
          {entries.length === 0 && <span className="muted">Nothing logged on this day.</span>}
        </p>
      </div>

      {dayStats && summary.subject.kind === "child" && (
        <AgeCheck
          totals={dayStats}
          birthDate={summary.subject.birth_date}
          day={day}
          complete={day < today}
          title={day === today ? "Today against her age" : "Against her age"}
          subtitle={day === today ? "Counts so far. Nothing is flagged until the day is over." : undefined}
        />
      )}

      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <li key={e.id}>
            <Link href={`/lana/entry/${e.id}`} className="card flex items-center gap-3 no-underline">
              <span aria-hidden className="text-3xl">
                {e.icon}
              </span>
              <span className="flex-1">
                <span className="block text-lg font-semibold">
                  {fmtTime(e.occurred_at, tz)}
                  {e.ended_at ? ` – ${fmtTime(e.ended_at, tz)}` : e.type_id === "lana.sleep" ? " – still sleeping" : ""}
                  {"  "}
                  <span className="font-normal">{e.type_label}</span>
                </span>
                <span className="muted block">
                  {[describePayload(e.payload), e.note].filter(Boolean).join(" · ")}
                </span>
                <span className="muted block text-sm">{e.attributed_name ?? e.logged_by_name}</span>
              </span>
              <span aria-hidden className="muted">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-2 gap-3">
        {summary.types.map((t) => (
          <Link key={t.id} href={`/lana/log/${t.key}`} className="btn btn-primary min-h-[64px] text-lg">
            <span aria-hidden>{t.icon}</span> {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
