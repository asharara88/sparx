import type { DayTotals } from "@/lib/norms";
import { ageDays, ageLabel, checkDay } from "@/lib/norms";
import { Icon } from "./Icon";

/**
 * Lana's totals against what is typical for her age. One row per measure,
 * a red pill where she fell short on a finished day. Today only shows "so far".
 */
export function AgeCheck({
  totals,
  birthDate,
  day,
  complete,
  title,
  subtitle,
}: {
  totals: DayTotals;
  birthDate: string | null;
  day: string;
  complete: boolean;
  title: string;
  subtitle?: string;
}) {
  if (!birthDate) {
    return (
      <section className="card">
        <h2 className="section-title">{title}</h2>
        <p className="muted text-sm">Add her date of birth on her profile to compare with her age.</p>
      </section>
    );
  }
  const days = ageDays(birthDate, day);
  const rows = checkDay(totals, days, complete);
  const short = rows.filter((r) => r.verdict === "short");
  return (
    <section className="card flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="section-title">{title}</h2>
        <span className="muted text-sm">{ageLabel(days)} old</span>
      </div>
      {subtitle && <p className="muted text-sm">{subtitle}</p>}
      {short.length > 0 && (
        <p className="notice notice-warn flex items-center gap-2">
          <Icon name="bell" size={20} className="shrink-0" />
          <span>
            Short on {short.map((r) => r.label.toLowerCase()).join(", ")}. If the day was fully logged, keep an eye on it.
          </span>
        </p>
      )}
      <table className="w-full text-sm">
        <thead className="muted text-left text-xs uppercase tracking-wide">
          <tr>
            <th className="py-1 font-semibold">Measure</th>
            <th className="py-1 text-right font-semibold">Lana</th>
            <th className="py-1 text-right font-semibold">Typical</th>
            <th className="py-1 text-right font-semibold">
              <span className="sr-only">Status</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-[var(--line)]">
              <td className="py-1.5">
                {r.label}
                {r.note && <span className="muted block text-xs">{r.note}</span>}
              </td>
              <td className="whitespace-nowrap py-1.5 text-right font-semibold tabular-nums">{r.value}</td>
              <td className="muted whitespace-nowrap py-1.5 pl-2 text-right tabular-nums">{r.typical}</td>
              <td className="py-1.5 pl-2 text-right">
                {r.verdict === "short" && <span className="pill pill-danger">short</span>}
                {r.verdict === "more" && <span className="pill">more</span>}
                {r.verdict === "ok" && <span className="pill pill-ok">ok</span>}
                {r.verdict === "so_far" && <span className="pill">so far</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted text-xs">Typical ranges for a healthy baby from the NHS, the American Academy of Pediatrics and the National Sleep Foundation. Only what was written down counts. Not medical advice.</p>
    </section>
  );
}
