import Link from "next/link";
import type { MaintenanceOverview } from "@/lib/types";
import { TICKET_STATUS } from "@/lib/types";

/** The house on the home screen: open tickets at a glance. */
export function HouseCard({ data }: { data: MaintenanceOverview }) {
  return (
    <section className="card" aria-labelledby="house-h">
      <div className="flex items-baseline justify-between">
        <h2 id="house-h" className="text-xl font-semibold">
          🏠 The house
        </h2>
        <Link href="/house" className="text-sm font-semibold text-[var(--accent)]">
          All ›
        </Link>
      </div>
      {data.open === 0 ? (
        <p className="muted mt-1">Nothing to fix.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {data.recent.map((t) => (
            <li key={t.id}>
              <Link href={`/house/tickets/${t.id}`} className="block">
                {TICKET_STATUS.find((s) => s.id === t.status)?.icon} {t.priority === "urgent" ? "🔥 " : ""}
                <b>{t.title}</b>
                {t.location ? <span className="muted"> · {t.location}</span> : null}
              </Link>
            </li>
          ))}
          {data.open > data.recent.length && <li className="muted text-sm">and {data.open - data.recent.length} more</li>}
        </ul>
      )}
    </section>
  );
}
