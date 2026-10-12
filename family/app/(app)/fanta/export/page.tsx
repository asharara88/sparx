import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DueItem, EntryRow, Me, Subject } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, dayRange, describePayload, fmtDate, fmtTime, todayYmd } from "@/lib/time";
import { PrintButton } from "@/components/PrintButton";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

/** Fanta's card and log for the vet: profile, treatments with next due dates, weights, the last 90 days. */
export default async function FantaExportPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "fanta", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const from = addDays(today, -90);
  const { data: subject } = await supabase.from("care_subjects").select("*").eq("module_id", "fanta").eq("is_active", true).order("sort").limit(1).single();
  if (!subject) redirect("/");
  const s = subject as Subject;
  const p = s.profile ?? {};
  const [{ data: dueData }, { data: listData }] = await Promise.all([
    supabase.rpc("care_due_list", { p_days_ahead: 400 }),
    supabase.rpc("care_entries_list", { p_subject_id: s.id, p_from: dayRange(from, tz).from, p_to: dayRange(today, tz).to }),
  ]);
  const due = (((dueData as { items?: DueItem[] })?.items ?? []) as DueItem[]).filter((d) => d.subject_id === s.id && d.kind === "treatment");
  const entries = ((listData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
  const weights = entries.filter((e) => e.type_id === "fanta.weight");
  const treatments = entries.filter((e) => e.type_id === "fanta.treatment" || e.type_id === "fanta.vet");
  const rest = entries.filter((e) => !["fanta.food", "fanta.litter", "fanta.treat"].includes(e.type_id) && e.type_id !== "fanta.weight" && e.type_id !== "fanta.treatment" && e.type_id !== "fanta.vet");
  const fields: [string, unknown][] = [
    ["Microchip", p.microchip], ["Sex", p.sex], ["Colour", p.colour], ["Age", p.age_note ?? (s.birth_date ? `born ${s.birth_date}` : null)], ["Spayed", p.spayed ? "yes" : null], ["Indoor", p.indoor ? "yes" : null],
    ["Food", p.food], ["Allergies / conditions", p.allergies], ["Insurance", p.insurance], ["Clinic", p.clinic], ["Notes", p.notes],
  ];
  return (
    <div className="flex flex-col gap-4 print:gap-2">
      <header className="page-header no-print flex items-center gap-2">
        <Link href="/fanta/profile" className="icon-btn" aria-label="Back">
          <Icon name="back" size={24} />
        </Link>
        <PrintButton label="Print or save as PDF for the vet" />
      </header>
      <section className="print-page">
        <h1 className="page-title">{s.name}</h1>
        <p className="muted">For the vet · {fmtDate(today, tz, { day: "numeric", month: "long", year: "numeric" })} · {me.household.name}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {fields.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
            <div key={k} className="contents"><dt className="muted">{k}</dt><dd className="font-semibold">{String(v)}</dd></div>
          ))}
        </dl>

        <h2 className="mt-4 text-lg font-bold">Treatments and what is due</h2>
        {due.length === 0 && treatments.length === 0 ? (
          <p className="muted text-sm">Nothing logged yet.</p>
        ) : (
          <table className="mt-1 w-full text-sm">
            <thead><tr className="text-left"><th>Date</th><th>What</th><th>Next due</th></tr></thead>
            <tbody>
              {treatments.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDate(e.occurred_at, tz)}</td>
                  <td>{e.type_label}{Object.keys(e.payload).length ? ` · ${describePayload({ ...e.payload, next_due: undefined })}` : ""}{e.note ? ` · ${e.note}` : ""}</td>
                  <td>{typeof e.payload.next_due === "string" ? e.payload.next_due : ""}</td>
                </tr>
              ))}
              {due.filter((d) => !treatments.some((t) => t.id === d.entry_id)).map((d) => (
                <tr key={d.label + d.due_at}><td></td><td>{d.label}</td><td>{d.due_on}{d.overdue ? " (overdue)" : ""}</td></tr>
              ))}
            </tbody>
          </table>
        )}

        {weights.length > 0 && (
          <>
            <h2 className="mt-4 text-lg font-bold">Weight</h2>
            <ul className="mt-1 text-sm">{weights.map((e) => <li key={e.id}>{fmtDate(e.occurred_at, tz)} · {describePayload(e.payload)}</li>)}</ul>
          </>
        )}
        {rest.length > 0 && (
          <>
            <h2 className="mt-4 text-lg font-bold">Notes, last 90 days</h2>
            <ul className="mt-1 text-xs">
              {rest.map((e) => (
                <li key={e.id}>{fmtDate(e.occurred_at, tz)} {fmtTime(e.occurred_at, tz)} · {e.type_label}{Object.keys(e.payload).length ? ` · ${describePayload(e.payload)}` : ""}{e.note ? ` · ${e.note}` : ""}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
