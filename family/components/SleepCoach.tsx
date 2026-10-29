import Link from "next/link";
import type { EntryRow } from "@/lib/types";
import { sleepCoach } from "@/lib/child-insights";

/** The child's sleep rhythm from the last 14 days: one tip, then usual nap, best awake window, usual bedtime as rows. `bare` sits flat inside a fold. */
export function SleepCoach({ entries, ageDays, timezone, bare = false }: { entries: EntryRow[]; ageDays: number; timezone: string; bare?: boolean }) {
  const hourOf = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
    return Number(parts.find((p) => p.type === "hour")?.value ?? 0) + Number(parts.find((p) => p.type === "minute")?.value ?? 0) / 60;
  };
  const c = sleepCoach(entries, ageDays, hourOf);
  const rows: [string, string][] = c
    ? [
        ["Usual nap", c.napMin ? `${c.napMin} min` : "—"],
        ["Awake before the best naps", c.bestWindowMin ? `${c.bestWindowMin} min` : "—"],
        ["Usual bedtime", c.bedtime ?? "—"],
      ]
    : [];
  return (
    <section className={bare ? "flex flex-col gap-2" : "card flex flex-col gap-2"} aria-labelledby="sc-h">
      <h2 id="sc-h" className={bare ? "sr-only" : "font-semibold"}>
        Sleep coach
      </h2>
      {!c ? (
        <p className="muted text-sm">Log a few more sleeps with an end time and the rhythm will show here.</p>
      ) : (
        <>
          <p className="font-semibold">{c.tip}</p>
          <ul className="flex flex-col">
            {rows.map(([k, v]) => (
              <li key={k} className="row">
                <span className="flex-1">{k}</span>
                <span className="font-semibold">{v}</span>
              </li>
            ))}
          </ul>
          <p className="muted text-sm">From {c.naps} daytime naps in the last 14 days. An estimate, not advice.</p>
          <Link href={`/ask?from=patterns&say=${encodeURIComponent("Look at the sleep log over the last two weeks and tell me what to try for better naps and bedtime.")}`} className="btn">
            Talk to the coach
          </Link>
        </>
      )}
    </section>
  );
}
