import Link from "next/link";
import type { EntryRow } from "@/lib/types";
import { nextNap } from "@/lib/child-insights";
import { fmtDuration, fmtTime } from "@/lib/time";

/**
 * "Next nap around 11:40": the last wake-up plus the child's own awake window,
 * recalculated every time the page loads, so a late nap moves the next one.
 */
export function NextNap({ entries, ageDays, timezone, now = Date.now(), compact = false }: { entries: EntryRow[]; ageDays: number; timezone: string; now?: number; compact?: boolean }) {
  const hourOf = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
    return Number(parts.find((p) => p.type === "hour")?.value ?? 0) + Number(parts.find((p) => p.type === "minute")?.value ?? 0) / 60;
  };
  const n = nextNap(entries, ageDays, now, hourOf);
  if (!n || n.asleepSince) return null;
  // No sleep logged for 12 hours means the log has a gap, not a baby awake that long
  // (it once said "awake 1214 min"): say nothing rather than something wrong.
  if (n.awakeMin > 12 * 60) return null;
  const inMin = Math.round((n.at! - now) / 60_000);
  const what = n.isBedtime ? "Bedtime" : "Next nap";
  const when = inMin >= 0 ? `in about ${fmtDuration(inMin)}` : `${fmtDuration(-inMin)} past the window`;
  const tone = inMin < 0 ? "notice-warn" : inMin <= 15 ? "notice-night" : "";
  if (compact) {
    return (
      <p className={`notice ${tone} text-sm`}>
        <b>
          {what} ~{fmtTime(new Date(n.at!).toISOString(), timezone)}
        </b>{" "}
        · {when} · awake {fmtDuration(n.awakeMin)}
      </p>
    );
  }
  return (
    <section className={`card ${inMin < 0 ? "ring-2 ring-[var(--warn)]" : ""}`} aria-labelledby="nap-h">
      <h2 id="nap-h" className="font-semibold">
        {what} around {fmtTime(new Date(n.at!).toISOString(), timezone)}
      </h2>
      <p className="text-lg">{when}.</p>
      <p className="muted text-sm">
        Awake since {fmtTime(n.since!, timezone)} ({fmtDuration(n.awakeMin)}). The window is about {n.windowMin} min, from {n.basis}. It moves with the day: a late nap pushes the next one.
      </p>
      {inMin < 0 && <p className="muted text-sm">Past the window a baby gets wired rather than sleepy. Start the wind-down now rather than later.</p>}
      <Link href="/baby/quick/sleep" className="btn mt-2">
        Fell asleep
      </Link>
    </section>
  );
}
