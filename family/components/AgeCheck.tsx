import type { DayTotals } from "@/lib/norms";
import { ageDays, ageLabel, checkDay } from "@/lib/norms";
import { Icon } from "./Icon";

/**
 * The child's totals against what is typical for the age, one row per measure:
 * what was logged on the right, the usual range under the name, a red pill only
 * where a finished day fell short. A list, not a table: four columns do not fit a phone.
 */
export function AgeCheck({
  totals,
  birthDate,
  day,
  complete,
  title,
  subtitle,
  bare = false,
}: {
  totals: DayTotals;
  birthDate: string | null;
  day: string;
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
        <p className="muted text-sm">Add the date of birth on the profile to compare with what is typical for the age.</p>
      </section>
    );
  }
  const days = ageDays(birthDate, day);
  const rows = checkDay(totals, days, complete);
  const short = rows.filter((r) => r.verdict === "short");
  return (
    <section className={bare ? "flex flex-col gap-2" : "card flex flex-col gap-2"} aria-label={bare ? title : undefined}>
      {!bare && (
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="section-title">{title}</h2>
          <span className="muted shrink-0 text-sm">{ageLabel(days)} old</span>
        </div>
      )}
      {(subtitle || bare) && <p className="muted text-sm">{[subtitle, bare ? `${ageLabel(days)} old` : null].filter(Boolean).join(" ")}</p>}
      {/* Inside a fold the red "short" pills on the rows say it; no box in a box. */}
      {short.length > 0 && !bare && (
        <p className="notice notice-warn flex items-center gap-2">
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
      <p className="muted text-xs">Ranges from the NHS, the AAP and the National Sleep Foundation. Only what was logged counts. Not medical advice.</p>
    </section>
  );
}
