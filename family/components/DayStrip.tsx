import type { EntryRow } from "@/lib/types";
import { fmtDuration, minutesBetween, zonedMidnight } from "@/lib/time";

/**
 * The child's 24 hours as two 12-hour rows (night 0–12, day 12–24): sleep in
 * purple, awake-at-night in light purple, breastfeeds blue with L/R, bottles
 * light blue with ml, diapers green dots, medicine red dots.
 */
export function DayStrip({
  entries,
  day,
  timezone,
  nowIso,
  title,
}: {
  entries: EntryRow[];
  day: string; // YYYY-MM-DD in the household timezone
  timezone: string;
  nowIso?: string; // clip open entries and draw the "now" line
  title?: string;
}) {
  const start = zonedMidnight(day, timezone).getTime();
  const end = start + 24 * 3600 * 1000;
  const now = nowIso ? new Date(nowIso).getTime() : end;
  const minute = (ms: number) => (ms - start) / 60000;

  // clip an entry to the day and return [fromMinute, toMinute]
  const clip = (e: EntryRow): [number, number] | null => {
    const a = new Date(e.occurred_at).getTime();
    const b = e.ended_at ? new Date(e.ended_at).getTime() : Math.min(now, end);
    if (b < start || a >= end) return null;
    return [Math.max(0, minute(a)), Math.min(1440, minute(b))];
  };
  const inDay = (e: EntryRow) => {
    const t = new Date(e.occurred_at).getTime();
    return t >= start && t < end;
  };

  const sleeps = entries.filter((e) => e.type_id === "lana.sleep");
  const wakes = entries.filter((e) => e.type_id === "lana.wake");
  const feeds = entries.filter((e) => e.type_id === "lana.feed");
  const diapers = entries.filter((e) => e.type_id === "lana.diaper");
  const meds = entries.filter((e) => e.type_id === "lana.medication");

  let sleepMin = 0;
  for (const s of sleeps) {
    const c = clip(s);
    if (c) sleepMin += c[1] - c[0];
  }
  let breastMin = 0, left = 0, right = 0, bottleMl = 0, bottles = 0;
  for (const f of feeds.filter(inDay)) {
    if (f.payload.method === "Breast") {
      breastMin += f.ended_at ? minutesBetween(f.occurred_at, f.ended_at) : 0;
      if (f.payload.side === "Left") left += 1;
      if (f.payload.side === "Right") right += 1;
    } else {
      bottles += 1;
      if (typeof f.payload.amount_ml === "number") bottleMl += f.payload.amount_ml;
    }
  }
  const diaperCount = diapers.filter(inDay).length;

  const Row = ({ from }: { from: number }) => {
    const to = from + 720;
    const pct = (m: number) => `${((Math.max(from, Math.min(to, m)) - from) / 720) * 100}%`;
    const width = (a: number, b: number) => `${((Math.max(from, Math.min(to, b)) - Math.max(from, Math.min(to, a))) / 720) * 100}%`;
    const inRow = (a: number, b: number) => b > from && a < to;
    return (
      <div>
        <div className="relative h-20 overflow-hidden rounded-xl bg-neutral-200">
          {/* hour grid */}
          {[3, 6, 9].map((h) => (
            <div key={h} className="absolute inset-y-0 w-px bg-white/70" style={{ left: `${(h / 12) * 100}%` }} aria-hidden />
          ))}
          {sleeps.map((e) => {
            const c = clip(e);
            if (!c || !inRow(c[0], c[1])) return null;
            return <div key={e.id} className="absolute top-9 h-6 rounded-md bg-purple-700" style={{ left: pct(c[0]), width: width(c[0], c[1]) }} title="Sleep" />;
          })}
          {wakes.map((e) => {
            const c = clip(e);
            if (!c || !inRow(c[0], c[1])) return null;
            return <div key={e.id} className="absolute top-9 h-6 rounded-md bg-indigo-300" style={{ left: pct(c[0]), width: width(c[0], c[1]) }} title="Awake at night" />;
          })}
          {feeds.map((e, i) => {
            const c = clip(e);
            if (!c || !inRow(c[0], c[1])) return null;
            const lane = i % 2 === 0 ? "top-1" : "top-5";
            const breast = e.payload.method === "Breast";
            const label = breast ? String(e.payload.side ?? "").slice(0, 1) : typeof e.payload.amount_ml === "number" ? `${e.payload.amount_ml}` : "B";
            const w = Math.max(c[1] - c[0], 14);
            return (
              <div
                key={e.id}
                className={`absolute ${lane} flex h-4 items-center justify-center rounded text-[10px] font-bold text-white ${breast ? "bg-blue-700" : "bg-sky-500"}`}
                style={{ left: pct(c[0]), width: width(c[0], c[0] + w), minWidth: 14 }}
                title={breast ? `Breast ${e.payload.side ?? ""}` : `Bottle ${e.payload.amount_ml ?? ""} ml`}
              >
                {label}
              </div>
            );
          })}
          {diapers.map((e) => {
            const m = minute(new Date(e.occurred_at).getTime());
            if (m < from || m >= to) return null;
            return <div key={e.id} className={`absolute bottom-1 h-3 w-3 -translate-x-1/2 rounded-full ${e.payload.kind === "Wet" ? "bg-green-300" : "bg-green-700"}`} style={{ left: pct(m) }} title={`Diaper ${e.payload.kind ?? ""}`} />;
          })}
          {meds.map((e) => {
            const m = minute(new Date(e.occurred_at).getTime());
            if (m < from || m >= to) return null;
            return <div key={e.id} className="absolute bottom-1 h-3 w-3 -translate-x-1/2 rounded-full bg-red-600" style={{ left: pct(m) }} title="Medicine" />;
          })}
          {nowIso && now > start && now < end && minute(now) >= from && minute(now) < to && (
            <div className="absolute inset-y-0 w-0.5 bg-black" style={{ left: pct(minute(now)) }} aria-label="now" />
          )}
        </div>
        <div className="muted flex justify-between text-xs">
          {[0, 3, 6, 9, 12].map((h) => (
            <span key={h}>{String((from / 60 + h) % 24).padStart(2, "0")}:00</span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="card">
      {title && <p className="mb-2 font-semibold">{title}</p>}
      <div className="flex flex-col gap-2">
        <Row from={0} />
        <Row from={720} />
      </div>
      {/* The day's numbers, one tinted tile each: the colour says what, the number says how much. */}
      <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
        <div className="tint-sleep rounded-xl px-1 py-2">
          <dd className="text-lg font-bold leading-tight">{fmtDuration(Math.round(sleepMin))}</dd>
          <dt className="text-[11px] font-semibold opacity-75">sleep</dt>
        </div>
        <div className="tint-feed rounded-xl px-1 py-2">
          <dd className="text-lg font-bold leading-tight">{fmtDuration(breastMin)}</dd>
          <dt className="text-[11px] font-semibold opacity-75">
            breast · L{left} R{right}
          </dt>
        </div>
        <div className="tint-feed rounded-xl px-1 py-2">
          <dd className="text-lg font-bold leading-tight">{bottleMl} ml</dd>
          <dt className="text-[11px] font-semibold opacity-75">
            {bottles} bottle{bottles === 1 ? "" : "s"}
          </dt>
        </div>
        <div className="tint-diaper rounded-xl px-1 py-2">
          <dd className="text-lg font-bold leading-tight">{diaperCount}</dd>
          <dt className="text-[11px] font-semibold opacity-75">nappies</dt>
        </div>
      </dl>
    </div>
  );
}
