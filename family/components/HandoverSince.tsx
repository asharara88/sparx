import type { EntryRow } from "@/lib/types";
import { fmtDuration } from "@/lib/time";
import { windowStats } from "@/lib/handover";

/** "Since Mama left" or "While Mama was at work": bottles, diapers, naps in that window. */
export function HandoverSince({ entries, fromIso, toIso, label }: { entries: EntryRow[]; fromIso: string; toIso: string; label: string }) {
  const s = windowStats(entries, fromIso, toIso);
  const Stat = ({ n, l }: { n: string | number; l: string }) => (
    <div className="rounded-xl bg-[var(--card-2)] p-3 text-center">
      <p className="text-2xl font-bold">{n}</p>
      <p className="muted text-xs font-semibold">{l}</p>
    </div>
  );
  return (
    <section className="card" aria-label={label}>
      <p className="muted text-xs font-semibold uppercase tracking-wide">{label}</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Stat n={s.bottles + s.breast} l={s.ml ? `feeds · ${s.ml} ml` : "feeds"} />
        <Stat n={s.diapers} l="diapers" />
        <Stat n={s.naps ? fmtDuration(s.napMin) : 0} l={s.naps ? `${s.naps} nap${s.naps > 1 ? "s" : ""}` : "naps"} />
      </div>
    </section>
  );
}
