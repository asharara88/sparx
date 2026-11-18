import Link from "next/link";
import type { EntryRow } from "@/lib/types";
import { sleepCoach } from "@/lib/child-insights";

/**
 * The child's sleep rhythm from the last 14 days: one tip, then usual nap, best awake window,
 * usual bedtime as rows (lib/child-insights builds them: a toddler's in hours and minutes, and
 * only the usual bedtime with no daytime nap). `bare` sits flat inside a fold.
 */
export function SleepCoach({ entries, ageDays, sex, napsPerDay, timezone, bare = false }: { entries: EntryRow[]; ageDays: number; /** The child's recorded sex, for the tip's words. */ sex: string | null; /** napPattern's perDay (a toddler's naps a day); null for a baby. */ napsPerDay: number | null; timezone: string; bare?: boolean }) {
  const hourOf = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
    return Number(parts.find((p) => p.type === "hour")?.value ?? 0) + Number(parts.find((p) => p.type === "minute")?.value ?? 0) / 60;
  };
  const c = sleepCoach(entries, ageDays, hourOf, sex, napsPerDay);
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
            {c.rows.map((r) => (
              <li key={r.label} className="row">
                <span className="flex-1">{r.label}</span>
                <span className="font-semibold">{r.value}</span>
              </li>
            ))}
          </ul>
          {/* A toddler with no daytime nap gets the bedtime row alone, and the tip already says so. */}
          {c.rows.length > 1 && <p className="muted text-sm">From {c.naps} daytime naps in the last 14 days. An estimate, not advice.</p>}
          <Link prefetch={false} href={`/ask?from=patterns&say=${encodeURIComponent("Look at the sleep log over the last two weeks and tell me what to try for better naps and bedtime.")}`} className="btn">
            Talk to the coach
          </Link>
        </>
      )}
    </section>
  );
}
