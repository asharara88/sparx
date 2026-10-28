import Link from "next/link";
import type { EntryRow } from "@/lib/types";
import { describePayload, fmtDuration, fmtTime, minutesBetween, zonedMidnight } from "@/lib/time";
import { tintFor } from "@/lib/tints";

/**
 * The child's day in plain words: four tinted totals (sleep, breast, bottles,
 * nappies) and, unless the page lists the day itself, the day's entries newest
 * first in their feature colour. Two grey 12-hour bars with L/R badges, cut-off
 * millilitres, unlabelled dots and a black "now" line stood here before; nobody
 * could read them.
 */
export function DayStrip({
  entries,
  day,
  timezone,
  nowIso,
  title,
  list = true,
}: {
  entries: EntryRow[];
  day: string; // YYYY-MM-DD in the household timezone
  timezone: string;
  nowIso?: string; // clip an open sleep at "now"
  title?: string;
  list?: boolean; // false when the page lists the day's entries itself
}) {
  const start = zonedMidnight(day, timezone).getTime();
  const end = start + 24 * 3600 * 1000;
  const now = nowIso ? new Date(nowIso).getTime() : end;
  const inDay = (e: EntryRow) => {
    const t = new Date(e.occurred_at).getTime();
    return t >= start && t < end;
  };

  // minutes of a sleep that fall inside the day; an open one counts up to now
  let sleepMin = 0;
  for (const s of entries.filter((e) => e.type_id === "lana.sleep")) {
    const a = Math.max(start, new Date(s.occurred_at).getTime());
    const b = Math.min(end, s.ended_at ? new Date(s.ended_at).getTime() : now);
    if (b > a) sleepMin += Math.round((b - a) / 60000);
  }
  let breastMin = 0, breastCount = 0, bottleMl = 0, bottles = 0;
  for (const f of entries.filter((e) => e.type_id === "lana.feed" && inDay(e))) {
    if (f.payload.method === "Breast") {
      breastCount += 1;
      breastMin += f.ended_at ? minutesBetween(f.occurred_at, f.ended_at) : 0;
    } else {
      bottles += 1;
      if (typeof f.payload.amount_ml === "number") bottleMl += f.payload.amount_ml;
    }
  }
  const nappies = entries.filter((e) => e.type_id === "lana.diaper" && inDay(e)).length;

  const tiles: { tint: string; value: string; label: string }[] = [
    { tint: "sleep", value: sleepMin ? fmtDuration(sleepMin) : "—", label: "sleep" },
    { tint: "feed", value: breastMin ? fmtDuration(breastMin) : breastCount ? `${breastCount}` : "—", label: breastCount === 1 ? "1 breastfeed" : `${breastCount || ""} breastfeeds`.trim() },
    { tint: "milk", value: bottleMl ? `${bottleMl} ml` : bottles ? `${bottles}` : "—", label: bottles === 1 ? "1 bottle" : `${bottles || ""} bottles`.trim() },
    { tint: "diaper", value: nappies ? `${nappies}` : "—", label: "nappies" },
  ];

  const rows = entries.filter(inDay).sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));

  return (
    <div className="card">
      {title && <p className="mb-2 font-semibold">{title}</p>}
      {/* The day's numbers, one tinted tile each: the colour says what, the number says how much. */}
      <dl className="grid grid-cols-2 gap-2 text-center">
        {tiles.map((t) => (
          <div key={t.label} className={`tint-${t.tint} rounded-xl px-1 py-2`}>
            <dd className="text-xl font-bold leading-tight">{t.value}</dd>
            <dt className="text-xs font-semibold opacity-75">{t.label}</dt>
          </div>
        ))}
      </dl>
      {list &&
        (rows.length === 0 ? (
          <p className="muted mt-3 text-sm">Nothing logged yet today.</p>
        ) : (
          <ul className="mt-3 flex flex-col">
            {rows.map((e) => (
              <li key={e.id} className="row">
                <Link href={`/baby/entry/${e.id}`} className="flex w-full items-center gap-3 no-underline">
                  <span aria-hidden className={`icon-disc tint-${tintFor(e.type_id.split(".")[1])} text-lg`} style={{ width: 32, height: 32 }}>
                    {e.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {fmtTime(e.occurred_at, timezone)}
                      {e.ended_at ? `–${fmtTime(e.ended_at, timezone)}` : e.type_id === "lana.sleep" ? "–…" : ""} <span className="font-normal">{e.type_label}</span>
                    </span>
                    <span className="muted block truncate text-sm">{[describePayload(e.payload), e.note].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span aria-hidden className="muted">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
