import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DueItem, EntryRow, HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, dayRange, describePayload, fmtTime, todayYmd } from "@/lib/time";
import { FantaCard } from "@/components/FantaCard";

export const dynamic = "force-dynamic";

export default async function FantaPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "fanta", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const { d } = await searchParams;
  const day = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today;

  const { data: subj } = await supabase.from("care_subjects").select("id").eq("module_id", "fanta").eq("is_active", true).order("sort").limit(1).single();
  if (!subj) redirect("/");
  const subjectId = (subj as { id: string }).id;
  const { from, to } = dayRange(day, tz);
  const [{ data: sumData }, { data: dueData }, { data: listData }] = await Promise.all([
    supabase.rpc("home_summary", { p_subject_id: subjectId }),
    supabase.rpc("care_due_list", { p_days_ahead: 60 }),
    supabase.rpc("care_entries_list", { p_subject_id: subjectId, p_from: from, p_to: to }),
  ]);
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  const due = ((dueData as { items?: DueItem[] })?.items ?? []) as DueItem[];
  const entries = ((listData as { entries?: EntryRow[] })?.entries ?? []) as EntryRow[];
  const label = day === today ? "Today" : day === addDays(today, -1) ? "Yesterday" : day;

  return (
    <div className="flex flex-col gap-4">
      {day === today && <FantaCard summary={summary} due={due} />}
      <header className="flex items-center justify-between gap-2 pt-2">
        <Link href={`/fanta?d=${addDays(day, -1)}`} className="btn" aria-label="Previous day">
          ‹
        </Link>
        <h2 className="text-center text-xl font-bold">{label}</h2>
        <Link href={`/fanta?d=${addDays(day, 1)}`} className="btn" aria-label="Next day" style={day >= today ? { visibility: "hidden" } : undefined}>
          ›
        </Link>
      </header>
      {entries.length === 0 ? (
        <p className="muted card">Nothing logged.</p>
      ) : (
        <ul className="card flex flex-col divide-y divide-[var(--line)]">
          {entries.map((e) => (
            <li key={e.id}>
              <Link href={`/fanta/entry/${e.id}`} className="flex items-baseline gap-3 py-3">
                <span className="w-16 shrink-0 font-semibold tabular-nums">{fmtTime(e.occurred_at, tz)}</span>
                <span className="grow">
                  <span aria-hidden>{e.icon} </span>
                  <b>{e.type_label}</b>
                  {describePayload(e.payload) ? ` · ${describePayload(e.payload)}` : ""}
                  {e.note ? <span className="muted block text-sm">{e.note}</span> : null}
                </span>
                <span className="muted shrink-0 text-sm">{e.attributed_name ?? e.logged_by_name ?? ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
