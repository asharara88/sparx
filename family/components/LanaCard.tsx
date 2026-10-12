"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { EntryRow, HomeSummary } from "@/lib/types";
import { ago, fmtTime } from "@/lib/time";
import { CustodyToggle } from "./CustodyToggle";
import { LanaNow } from "./LanaNow";
import { DayStrip } from "./DayStrip";
import { Icon } from "@/components/Icon";

export function LanaCard({ summary, recent, lastMilk, milk }: { summary: HomeSummary; recent: EntryRow[]; lastMilk: string | null; milk?: { pumped: number; given: number; target: number; any: boolean } | null }) {
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

      {milk && milk.any && (
        <p className="muted text-sm">
          <Icon name="bottle" size={16} className="inline" /> Milk for today: {milk.pumped} ml pumped since last evening
          {milk.pumped < milk.target ? <span className="font-semibold text-[var(--warn)]"> (aim {milk.target})</span> : ` (aim ${milk.target})`}
          {milk.given > 0 ? ` · ${milk.given} ml given from the fridge` : ""}
          {milk.pumped > 0 ? ` · about ${Math.max(0, milk.pumped - milk.given)} ml left` : ""}
        </p>
      )}
      <DayStrip entries={recent} day={today} timezone={timezone} nowIso={now.toISOString()} title="Lana's day so far" />

      <div className="grid grid-cols-3 gap-2">
        <Link href="/lana" className="btn">
          Day by day
        </Link>
        <Link href="/lana/trends" className="btn">
          Trends
        </Link>
        <Link href="/lana/handover" className="btn">
          Handover
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
