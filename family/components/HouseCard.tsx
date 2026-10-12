import Link from "next/link";
import type { MaintenanceOverview } from "@/lib/types";
import { TICKET_STATUS } from "@/lib/types";
import { Icon } from "@/components/Icon";

/** The house on the home screen: open tickets at a glance. */
export function HouseCard({ data }: { data: MaintenanceOverview }) {
  return (
    <section className="card" aria-labelledby="house-h">
      <div className="flex items-baseline justify-between">
        <h2 id="house-h" className="text-xl font-semibold">
          The house
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
                <span className={`dot dot-${TICKET_STATUS.find((s) => s.id === t.status)?.tone}`} /> {t.priority === "urgent" ? <Icon name="flame" size={16} className="inline text-[var(--danger)]" /> : null}{" "}
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
