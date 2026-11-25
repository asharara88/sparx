import Link from "next/link";
import type { DayTotals, LoggedKinds } from "@/lib/norms";
import { ageDays, ageWords, checkDay, normsSource } from "@/lib/norms";
import { isToddler } from "@/lib/stage";
import { Icon } from "./Icon";

/**
 * The child's totals against what is typical for the age, one row per measure:
 * what was logged on the right, the usual range under the name, a red pill only
 * where a finished day fell short. A list, not a table: four columns do not fit a phone.
 * From 12 months nothing is judged and a kind with no logged day has no row (lib/norms);
 * with no row at all the card is not drawn.
 */
export function AgeCheck({
  totals,
  logged,
  birthDate,
  day,
  today,
  complete,
  title,
  subtitle,
  bare = false,
}: {
  totals: DayTotals;
  /** Which kinds have a logged day in the period (dayAverages' logged); read from 12 months only. */
  logged: LoggedKinds;
  birthDate: string | null;
  day: string;
  /** The home's today: a child who is a toddler today is judged as one, though `day` (the last whole day) may fall on the first birthday. */
  today: string;
  complete: boolean;
  title: string;
  subtitle?: string;
  /** Kept for callers; the list needs no column header. */
  name?: string;
  /** Inside a fold that already carries the title: no box and no second heading. */
  bare?: boolean;
}) {
  if (!birthDate) {
    return (
      <section className="card">
        <h2 className="section-title">{title}</h2>
        <p className="muted text-sm">
          <Link prefetch={false} href="/baby/doctor" className="font-semibold text-[var(--accent)]">
            Add the date of birth on Doctor, under Health card.
          </Link>
        </p>
      </section>
    );
  }
  const days = ageDays(birthDate, day);
  const now = ageDays(birthDate, today);
  // The day after the first birthday the rest of the screen is a toddler's: so is this card.
  const judged = isToddler(now) ? now : days;
  const rows = checkDay(totals, judged, complete, logged);
  if (rows.length === 0) return null;
  const short = rows.filter((r) => r.verdict === "short");
  const age = `${ageWords(birthDate, day)} old`;
  return (
    <section className={bare ? "flex flex-col gap-2" : "card flex flex-col gap-2"} aria-label={bare ? title : undefined}>
      {!bare && (
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="section-title">{title}</h2>
          <span className="muted shrink-0 text-sm">{age}</span>
        </div>
      )}
      {(subtitle || bare) && <p className="muted text-sm">{[subtitle, bare ? age : null].filter(Boolean).join(" ")}</p>}
      {/* Inside a fold the red "short" pills on the rows say it; no box in a box. */}
      {short.length > 0 && !bare && (
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--warn)]">
          <Icon name="bell" size={20} className="shrink-0" />
          <span>Short on {short.map((r) => r.label.toLowerCase()).join(", ")}. If the day was fully logged, keep an eye on it.</span>
        </p>
      )}
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.key} className="row">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{r.label}</span>
              <span className="muted block text-sm">
                {[r.typical && `Usually ${r.typical}`, r.note].filter(Boolean).join(". ")}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-lg font-bold tabular-nums">{r.value}</span>
              {r.verdict === "short" && <span className="pill pill-danger">short</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted text-xs">{normsSource(judged)}</p>
    </section>
  );
}
