import type { BagItem, HomeSummary } from "@/lib/types";
import { ago, describePayload, fmtTime } from "@/lib/time";
import { BagChecklist } from "./BagChecklist";

/** One screen for whoever takes over: last feed, nap, diaper, anything given today, the bag. */
export function HandoverPanel({ summary: s, bag }: { summary: HomeSummary; bag: BagItem[] }) {
  const tz = s.timezone;
  const now = new Date();
  const meds = s.today_entries.filter((e) => e.type_id === "lana.medication");
  const notes = s.today_entries.filter((e) => e.type_id === "lana.note");
  // A list row (DESIGN.md): what on the first line, how long ago, the detail and who under it, the time on the right.
  const Row = ({ label, typeId }: { label: string; typeId: string }) => {
    const l = s.last[typeId];
    const running = l && !l.ended_at && typeId === "lana.sleep";
    const detail = l ? describePayload(l.payload) : "";
    return (
      <li className="row">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{label}</p>
          <p className="muted text-sm">
            {l ? [running ? "still sleeping" : ago(l.ended_at ?? l.occurred_at, now), detail, l.by].filter(Boolean).join(" · ") : "nothing yet"}
          </p>
        </div>
        {l && (
          <span className="shrink-0 text-lg font-bold tabular-nums">
            {fmtTime(l.occurred_at, tz)}
            {l.ended_at ? `–${fmtTime(l.ended_at, tz)}` : ""}
          </span>
        )}
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <section className="card">
        <p className="muted">{s.custody?.name ? `${s.custody.name} has ${s.subject.name} right now.` : `Nobody is marked as having ${s.subject.name}.`}</p>
        <ul className="mt-1 flex flex-col">
          <Row label="Feed" typeId="lana.feed" />
          <Row label="Nap" typeId="lana.sleep" />
          <Row label="Diaper" typeId="lana.diaper" />
        </ul>
      </section>
      <section className="card">
        <h2 className="section-title">Given today</h2>
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
          <h2 className="section-title">Notes today</h2>
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
