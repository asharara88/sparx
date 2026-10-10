"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { EntryRow, HomeSummary } from "@/lib/types";
import { ago, fmtTime } from "@/lib/time";
import { CustodyToggle } from "./CustodyToggle";
import { LanaNow } from "./LanaNow";
import { DayStrip } from "./DayStrip";

export function LanaCard({ summary, recent, lastMilk }: { summary: HomeSummary; recent: EntryRow[]; lastMilk: string | null }) {
  const { subject, types, last, custody, timezone, ongoing, today } = summary;
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const now = new Date();
  const feed = last["lana.feed"];
  const diaper = last["lana.diaper"];
  const due = feed?.next_due ? new Date(feed.next_due) : null;
  const overdue = due ? due.getTime() < now.getTime() : false;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="lana-h">
      <div className="flex items-start justify-between gap-3">
        <h2 id="lana-h" className="text-2xl font-bold">
          {subject.name}
        </h2>
        <CustodyToggle subjectId={subject.id} custody={custody} />
      </div>

      <LanaNow subject={subject} types={types} ongoing={ongoing} recent={recent} timezone={timezone} lastMilk={lastMilk} />

      <p className="muted text-sm">
        {feed ? `Last feed ${ago(feed.ended_at ?? feed.occurred_at, now)} (${fmtTime(feed.occurred_at, timezone)})` : "No feed yet"}
        {due ? (
          <span className={overdue ? " font-semibold text-[var(--warn)]" : ""}>
            {overdue ? ` · due since ${fmtTime(feed!.next_due!, timezone)}` : ` · next about ${fmtTime(feed!.next_due!, timezone)}`}
          </span>
        ) : null}
        {diaper ? ` · last diaper ${ago(diaper.occurred_at, now)}` : ""}
      </p>

      <DayStrip entries={recent} day={today} timezone={timezone} nowIso={now.toISOString()} title="Lana's day so far" />

      <div className="grid grid-cols-2 gap-3">
        <Link href="/lana" className="btn">
          Day by day
        </Link>
        <Link href="/lana/handover" className="btn">
          Handover card
        </Link>
      </div>
      <p className="muted text-sm">
        Other entries:{" "}
        {types
          .filter((t) => !["feed", "diaper", "sleep", "wake"].includes(t.key))
          .map((t, i) => (
            <span key={t.id}>
              {i > 0 ? " · " : ""}
              <Link href={`/lana/log/${t.key}`} className="underline">
                {t.icon} {t.label}
              </Link>
            </span>
          ))}
      </p>
    </section>
  );
}
