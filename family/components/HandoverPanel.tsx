import type { BagItem, HomeSummary } from "@/lib/types";
import { ago, describePayload, fmtTime } from "@/lib/time";
import { BagChecklist } from "./BagChecklist";

/** One screen for whoever takes over: last feed, nap, diaper, anything given today, the bag. */
export function HandoverPanel({ summary: s, bag }: { summary: HomeSummary; bag: BagItem[] }) {
  const tz = s.timezone;
  const now = new Date();
  const meds = s.today_entries.filter((e) => e.type_id === "lana.medication");
  const notes = s.today_entries.filter((e) => e.type_id === "lana.note");
  const Row = ({ label, typeId }: { label: string; typeId: string }) => {
    const l = s.last[typeId];
    return (
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] py-3 last:border-0">
        <span className="font-semibold">{label}</span>
        <span className="text-right">
          {l ? (
            <>
              <span className="block text-lg font-bold">
                {fmtTime(l.occurred_at, tz)}
                {l.ended_at ? `–${fmtTime(l.ended_at, tz)}` : typeId === "lana.sleep" ? " (still sleeping)" : ""}
              </span>
              <span className="muted block text-sm">
                {ago(l.ended_at ?? l.occurred_at, now)}
                {describePayload(l.payload) ? ` · ${describePayload(l.payload)}` : ""}
                {l.by ? ` · ${l.by}` : ""}
              </span>
            </>
          ) : (
            <span className="muted">nothing yet</span>
          )}
        </span>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <section className="card">
        <p className="muted">{s.custody?.name ? `${s.custody.name} has ${s.subject.name} right now.` : `Nobody is marked as having ${s.subject.name}.`}</p>
        <Row label="Last feed" typeId="lana.feed" />
        <Row label="Last nap" typeId="lana.sleep" />
        <Row label="Last diaper" typeId="lana.diaper" />
      </section>
      <section className="card">
        <h2 className="font-semibold">Given today</h2>
        {meds.length === 0 ? (
          <p className="muted mt-1">No medicine given today.</p>
        ) : (
          <ul className="mt-1">
            {meds.map((m) => (
              <li key={m.id} className="py-1">
                {fmtTime(m.occurred_at, tz)} · {String(m.payload.name ?? "")} {String(m.payload.dose ?? "")}
                {m.by ? ` · ${m.by}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
      {notes.length > 0 && (
        <section className="card">
          <h2 className="font-semibold">Notes today</h2>
          <ul className="mt-1">
            {notes.map((n) => (
              <li key={n.id} className="py-1">
                {fmtTime(n.occurred_at, tz)} · {n.note}
              </li>
            ))}
          </ul>
        </section>
      )}
      <BagChecklist items={bag} />
    </div>
  );
}
