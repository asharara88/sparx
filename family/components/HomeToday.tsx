import Link from "next/link";
import type { EntryRow } from "@/lib/types";
import { zonedMidnight } from "@/lib/time";
import { Icon } from "./Icon";

/** Today in one row on Home, "5 feeds · 1 h 20 sleep · 4 nappies" (short, so it fits one line), opening the child's day. */
export function HomeToday({ entries, day, timezone, nowIso }: { entries: EntryRow[]; day: string; timezone: string; nowIso: string }) {
  const start = zonedMidnight(day, timezone).getTime();
  const end = start + 24 * 3600 * 1000;
  const now = Date.parse(nowIso);
  const inDay = (e: EntryRow) => {
    const t = Date.parse(e.occurred_at);
    return t >= start && t < end;
  };
  const feeds = entries.filter((e) => e.type_id === "lana.feed" && inDay(e)).length;
  const nappies = entries.filter((e) => e.type_id === "lana.diaper" && inDay(e)).length;
  let sleepMin = 0;
  for (const s of entries.filter((e) => e.type_id === "lana.sleep")) {
    const a = Math.max(start, Date.parse(s.occurred_at));
    const b = Math.min(end, s.ended_at ? Date.parse(s.ended_at) : now);
    if (b > a) sleepMin += Math.round((b - a) / 60_000);
  }
  const parts = [
    feeds ? `${feeds} feed${feeds === 1 ? "" : "s"}` : null,
    sleepMin ? `${sleepMin < 60 ? `${sleepMin} min` : `${Math.floor(sleepMin / 60)} h${sleepMin % 60 ? ` ${sleepMin % 60}` : ""}`} sleep` : null,
    nappies ? `${nappies} napp${nappies === 1 ? "y" : "ies"}` : null,
  ].filter(Boolean);
  return (
    <Link href="/baby" className="flex min-h-[56px] items-center gap-3 rounded-2xl bg-[var(--card)] px-4 py-2 no-underline">
      <span className="min-w-0 flex-1">
        <span className="muted block text-xs font-semibold">Today</span>
        <span className="block font-semibold">{parts.length ? parts.join(" · ") : "Nothing logged yet"}</span>
      </span>
      <Icon name="forward" size={18} className="muted shrink-0" />
    </Link>
  );
}
