import Link from "next/link";
import type { EntryRow } from "@/lib/types";
import { sleepCoach } from "@/lib/child-insights";

/** The child's sleep rhythm from the last 14 days: usual nap, best awake window, usual bedtime, one tip. */
export function SleepCoach({ entries, ageDays, timezone }: { entries: EntryRow[]; ageDays: number; timezone: string }) {
  const hourOf = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
    return Number(parts.find((p) => p.type === "hour")?.value ?? 0) + Number(parts.find((p) => p.type === "minute")?.value ?? 0) / 60;
  };
  const c = sleepCoach(entries, ageDays, hourOf);
  const Stat = ({ n, l }: { n: string; l: string }) => (
    <div className="rounded-xl bg-[var(--card-2)] p-2 text-center">
      <p className="text-xl font-bold">{n}</p>
      <p className="muted text-xs">{l}</p>
    </div>
  );
  return (
    <section className="card flex flex-col gap-2" aria-labelledby="sc-h">
      <h2 id="sc-h" className="font-semibold">
        Sleep coach
      </h2>
      {!c ? (
        <p className="muted text-sm">Log a few more sleeps with an end time and the rhythm will show here.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat n={c.napMin ? `${c.napMin} min` : "—"} l="usual nap" />
            <Stat n={c.bestWindowMin ? `${c.bestWindowMin} min` : "—"} l="awake before the best naps" />
            <Stat n={c.bedtime ?? "—"} l="usual bedtime" />
          </div>
          <p className="notice text-sm font-semibold">{c.tip}</p>
          <p className="muted text-xs">From {c.naps} daytime naps in the last 14 days. An estimate, not advice.</p>
          <Link href={`/ask?from=patterns&say=${encodeURIComponent("Look at the sleep log over the last two weeks and tell me what to try for better naps and bedtime.")}`} className="btn">
            Talk to the coach
          </Link>
        </>
      )}
    </section>
  );
}
