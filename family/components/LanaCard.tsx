"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { HomeSummary } from "@/lib/types";
import { ago, describePayload, fmtTime } from "@/lib/time";
import { CustodyToggle } from "./CustodyToggle";
import { TimersCard } from "./TimersCard";

export function LanaCard({ summary }: { summary: HomeSummary }) {
  const { subject, types, last, today_counts, custody, timezone, ongoing } = summary;
  // re-render every minute so "x min ago" stays right while the phone sits on the table
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const now = new Date();
  const homeTypes = types.filter((t) => t.show_on_home);
  const logTypes = types.filter((t) => !t.settings?.timer || t.id === "lana.feed");
  const sleeping = ongoing.some((e) => e.type_id === "lana.sleep");

  return (
    <section className="card" aria-labelledby="lana-h">
      <div className="flex items-start justify-between gap-3">
        <h2 id="lana-h" className="text-2xl font-bold">
          {subject.name}
        </h2>
        <CustodyToggle subjectId={subject.id} custody={custody} />
      </div>

      <div className="mt-3">
        <TimersCard subjectId={subject.id} types={types} ongoing={ongoing} timezone={timezone} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3">
        {homeTypes.map((t) => {
          const l = last[t.id];
          const due = l?.next_due ? new Date(l.next_due) : null;
          const overdue = due ? due.getTime() < now.getTime() : false;
          return (
            <div key={t.id} className="rounded-xl border-2 border-[var(--line)] p-3">
              <dt className="muted text-sm font-semibold">
                <span aria-hidden>{t.icon} </span>Last {t.label.toLowerCase()}
              </dt>
              <dd className="mt-1">
                {l ? (
                  <>
                    <div className="text-lg font-bold">{ago(l.ended_at ?? l.occurred_at, now)}</div>
                    <div className="muted text-sm">
                      {fmtTime(l.occurred_at, timezone)}
                      {l.ended_at ? `–${fmtTime(l.ended_at, timezone)}` : ""}
                      {describePayload(l.payload) ? ` · ${describePayload(l.payload)}` : ""}
                    </div>
                    {due && !sleeping && (
                      <div className={`mt-1 text-sm font-semibold ${overdue ? "text-[var(--warn)]" : "muted"}`}>
                        {overdue ? `Due since ${fmtTime(l.next_due!, timezone)}` : `Next about ${fmtTime(l.next_due!, timezone)}`}
                      </div>
                    )}
                    {t.id === "lana.medication" && (
                      <div className="muted mt-1 text-sm">{today_counts[t.id] ?? 0} given today</div>
                    )}
                  </>
                ) : (
                  <div className="muted">Nothing yet</div>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {logTypes.map((t) => (
          <Link key={t.id} href={`/lana/log/${t.key}`} className="btn btn-primary min-h-[64px] text-lg">
            <span aria-hidden>{t.icon}</span> {t.label}
          </Link>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Link href="/lana" className="btn">
          Today’s list
        </Link>
        <Link href="/lana/handover" className="btn">
          Handover card
        </Link>
      </div>
    </section>
  );
}
