import Link from "next/link";
import type { EntryRow } from "@/lib/types";
import { describePayload, fmtDuration, fmtTime, minutesBetween, zonedMidnight } from "@/lib/time";
import { tintFor } from "@/lib/tints";
import { pottyCount, type TileKey } from "@/lib/day";

/** The four totals of a home with no saved day: a baby's, and a toddler's until a parent says otherwise. */
const USUAL: readonly TileKey[] = ["sleep", "breastfeeds", "bottles", "diapers"];

/**
 * The child's day in plain words: four tinted totals (sleep, breast, bottles,
 * diapers) and, unless the page lists the day itself, the day's entries newest
 * first in their feature colour. Two grey 12-hour bars with L/R badges, cut-off
 * millilitres, unlabelled dots and a black "now" line stood here before; nobody
 * could read them.
 *
 * With a saved day (lib/day.ts dayPlan's tiles) the day names the totals, four at most:
 * milk as one tile where it is a drink, the potty and meals where the family logs them,
 * and nothing for a kind it does not log.
 */
export function DayStrip({
  entries,
  day,
  timezone,
  nowIso,
  title,
  list = true,
  tiles: said = null,
}: {
  entries: EntryRow[];
  day: string; // YYYY-MM-DD in the household timezone
  timezone: string;
  nowIso?: string; // clip an open sleep at "now"
  title?: string;
  list?: boolean; // false when the page lists the day's entries itself
  tiles?: readonly TileKey[] | null; // the plan's tiles; absent or null, the usual four
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
  // Milk as a drink is one number: the day's ml when any was measured, else how many times.
  const milks = breastCount + bottles;
  const potty = pottyCount(entries.filter(inDay));
  const meals = entries.filter((e) => e.type_id === "lana.meal" && inDay(e)).length;

  const all: Record<TileKey, { tint: string; value: string; label: string }> = {
    sleep: { tint: "sleep", value: sleepMin ? fmtDuration(sleepMin) : "—", label: "sleep" },
    breastfeeds: { tint: "feed", value: breastMin ? fmtDuration(breastMin) : breastCount ? `${breastCount}` : "—", label: breastCount === 1 ? "1 breastfeed" : `${breastCount || ""} breastfeeds`.trim() },
    bottles: { tint: "milk", value: bottleMl ? `${bottleMl} ml` : bottles ? `${bottles}` : "—", label: bottles === 1 ? "1 bottle" : `${bottles || ""} bottles`.trim() },
    milk: { tint: "feed", value: bottleMl ? `${bottleMl} ml` : milks ? `${milks}` : "—", label: "milk" },
    diapers: { tint: "diaper", value: nappies ? `${nappies}` : "—", label: "diapers" },
    potty: { tint: "diaper", value: potty ? `${potty}` : "—", label: "potty" },
    meals: { tint: "food", value: meals ? `${meals}` : "—", label: meals === 1 ? "meal" : "meals" },
  };
  const keys = said ?? USUAL;

  const rows = entries.filter(inDay).sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));

  // One box deep: the tinted tiles sit on the page, not in a white card (no card in a card).
  return (
    <div>
      {title && <p className="mb-2 font-semibold">{title}</p>}
      {/* The day's numbers, one tinted tile each: the colour says what, the number says how much. */}
      <dl className="grid grid-cols-2 gap-2 text-center">
        {keys.map((k, i) => (
          // An odd one out takes the whole row, so three totals do not leave a hole.
          <div key={k} className={`tint-${all[k].tint} rounded-xl px-1 py-2${keys.length % 2 && i === keys.length - 1 ? " col-span-2" : ""}`}>
            <dd className="text-xl font-bold leading-tight">{all[k].value}</dd>
            <dt className="text-xs font-semibold opacity-75">{all[k].label}</dt>
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
                <Link prefetch={false} href={`/baby/entry/${e.id}`} className="flex w-full items-center gap-3 no-underline">
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
