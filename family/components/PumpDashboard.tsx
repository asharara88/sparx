import type { EntryRow, MilkData } from "@/lib/types";
import { pumpSummary, todayVersusUsual, type PumpDay } from "@/lib/pumping";
import { dateWords } from "@/lib/time";
import { PumpTarget } from "@/components/PumpTarget";

/**
 * The pumping screen: today's millilitres against the goal, the bottles at
 * home split by fridge and freezer, and the usual day from the last week
 * with today drawn beside it. Server-rendered; the only client part is the
 * goal card it shares with the old fold.
 */
export function PumpDashboard({ pumps, milk, target, days, today, hourOfDay }: { pumps: EntryRow[]; milk: MilkData | null; target: number; days: PumpDay[]; today: string; hourOfDay: number }) {
  const todayMl = pumps.reduce((a, e) => a + (Number(e.payload.amount_ml) || 0), 0);
  const s = pumpSummary(days, today, todayMl);
  const bars = [...s.week.map((d) => ({ ...d, today: false })), { day: today, ml: todayMl, today: true }];
  const label = (day: string) => dateWords(new Date(`${day}T12:00:00Z`), { weekday: "short", timeZone: "UTC" });
  return (
    <>
      <PumpTarget pumps={pumps} milk={null} target={target} canLog={false} />
      {milk && (
        <section className="grid grid-cols-2 gap-3" aria-label="Bottles at home">
          <div className="tile tint-milk">
            <span className="block text-2xl font-bold">{milk.fridge_count} {milk.fridge_count === 1 ? "bottle" : "bottles"}</span>
            <span className="text-sm">{milk.fridge_ml} ml in the fridge</span>
          </div>
          <div className="tile tint-diaper">
            <span className="block text-2xl font-bold">{milk.freezer_count} {milk.freezer_count === 1 ? "bottle" : "bottles"}</span>
            <span className="text-sm">{milk.freezer_ml} ml frozen</span>
          </div>
        </section>
      )}
      <section className="card flex flex-col gap-2" aria-labelledby="usual-h">
        <div className="flex items-baseline justify-between">
          <h2 id="usual-h" className="section-title">A usual day</h2>
          <span className="muted text-sm">last 7 days</span>
        </div>
        <p className="text-3xl font-bold tabular-nums">
          {s.averageMl} ml <span className="muted text-base font-semibold">{s.pumpingDays ? `on ${s.pumpingDays} pumping ${s.pumpingDays === 1 ? "day" : "days"}` : "no pumps yet"}</span>
        </p>
        <div className="flex items-end gap-1.5" style={{ height: 72 }} role="img" aria-label={`Pumped each day: ${bars.map((b) => `${label(b.day)} ${b.ml} ml`).join(", ")}`}>
          {bars.map((b) => (
            <div key={b.day} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" style={{ height: "100%" }}>
              <div className={`w-full rounded-t-md ${b.today ? "bg-[var(--accent)]" : "bg-[var(--accent-soft)]"}`} style={{ height: `${Math.max(4, Math.round((b.ml / s.maxMl) * 56))}px` }} />
              <span className={`text-[13px] leading-none ${b.today ? "font-semibold" : "muted"}`}>{b.today ? "today" : label(b.day)}</span>
            </div>
          ))}
        </div>
        <p className="muted text-sm">{todayVersusUsual(todayMl, s.averageMl, hourOfDay)}</p>
      </section>
    </>
  );
}
