import type { EntryRow } from "@/lib/types";
import { sleepDay } from "@/lib/sleep-day";
import { fmtTime, zonedMidnight } from "@/lib/time";
import { SleepBar } from "@/components/SleepDayLive";

/**
 * One day from midnight to midnight as a bar (DESIGN.md, "Day bar"): the sleep (the night she
 * woke from, each nap) and the feeds as marks, with a line for now on today. `lead` says which
 * of the two the screen is about: on Feeds the feeds are the strong marks and sleep steps
 * back, so "fed after the nap" can be seen; on Sleep it is the other way round. The times
 * themselves are in the list under the card, not here.
 */
export function DayBar({ entries, day, timezone, nowIso, night, lead }: { /** The week's entries, any kind. */ entries: EntryRow[]; day: string; timezone: string; nowIso: string; night: { from: string; to: string }; lead: "feeds" | "sleep" }) {
  const start = zonedMidnight(day, timezone).getTime();
  const end = start + 24 * 3600 * 1000;
  const isToday = Date.parse(nowIso) < end;
  const now = Math.min(Date.parse(nowIso), end);
  const hours = (hhmm: string, fallback: number) => {
    const n = Number(hhmm.slice(0, 2)) + Number(hhmm.slice(3, 5) || 0) / 60;
    return Number.isFinite(n) ? n : fallback;
  };
  const hourOf = (ms: number) => {
    const p = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: timezone }).format(new Date(ms)).split(":");
    return Number(p[0]) + Number(p[1]) / 60;
  };
  const s = sleepDay(entries, start, now, { bedtimeHour: hours(night.from, 19), morningHour: hours(night.to, 7), hourOf });
  const feeds = entries
    .filter((e) => e.type_id === "lana.feed")
    .map((e) => Date.parse(e.occurred_at))
    .filter((t) => t >= start && t < end)
    .sort((a, b) => a - b);
  const at = (ms: number) => fmtTime(new Date(ms).toISOString(), timezone);
  const sleepWords = s.segments.map((g) => `${g.kind} ${at(g.from)} to ${g.open ? "now" : at(g.to)}`).join(", ") || "none";
  const feedWords = feeds.map(at).join(", ") || "none";
  const label = lead === "feeds" ? `The day from midnight. Feeds at: ${feedWords}. Sleep: ${sleepWords}.` : `The day from midnight. Sleep: ${sleepWords}. Feeds at: ${feedWords}.`;
  return (
    <>
      <SleepBar segments={s.segments} dayStartMs={start} clockIso={new Date(now).toISOString()} live={isToday} label={label} marks={feeds} lead={lead} />
      <div className="-mt-1 flex justify-between text-[13px] opacity-80">
        <span>midnight</span>
        <span>noon</span>
        <span>midnight</span>
      </div>
    </>
  );
}
