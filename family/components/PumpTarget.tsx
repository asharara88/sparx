"use client";
import Link from "next/link";
import type { EntryRow, MilkData } from "@/lib/types";

/** Mama's pumping for the day against the household goal, with what is at home now. */
export function PumpTarget({ pumps, milk, target, canLog }: { pumps: EntryRow[]; milk: MilkData | null; target: number; canLog: boolean }) {
  const ml = pumps.reduce((a, e) => a + (Number(e.payload.amount_ml) || 0), 0);
  const min = Math.round(target * 0.9);
  const pct = Math.min(100, (ml / target) * 100);
  const done = ml >= min;
  return (
    <section className="card flex flex-col gap-2" aria-labelledby="pump-h">
      <div className="flex items-baseline justify-between">
        <h2 id="pump-h" className="section-title">Pumped since last evening</h2>
        <span className="muted text-sm">Goal {min} to {target} ml</span>
      </div>
      <p className="text-3xl font-bold tabular-nums">
        {ml} ml <span className="muted text-base font-semibold">{done ? "✓ goal reached" : `${min - ml} ml to go`}</span>
      </p>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-[var(--card-2)]">
        <div className={`h-full rounded-full ${done ? "bg-[var(--ok)]" : "bg-[var(--accent)]"}`} style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-[var(--fg)]/40" style={{ left: `${(min / target) * 100}%` }} />
      </div>
      <p className="muted text-sm">
        {pumps.length} pump{pumps.length === 1 ? "" : "s"}
        {milk ? ` · at home now: ${milk.fridge_ml} ml in the fridge, ${milk.freezer_ml} ml frozen` : ""}
      </p>
      {canLog && (
        <Link href="/baby/log/pump" className="btn btn-primary">
          Log a pump
        </Link>
      )}
    </section>
  );
}
