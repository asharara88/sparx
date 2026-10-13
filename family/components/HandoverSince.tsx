import type { EntryRow } from "@/lib/types";
import { fmtDuration, minutesBetween } from "@/lib/time";

/** "Since Mama left" or "While Mama was at work": bottles, diapers, naps in that window. */
export function HandoverSince({ entries, fromIso, toIso, label }: { entries: EntryRow[]; fromIso: string; toIso: string; label: string }) {
  const inWin = entries.filter((e) => e.occurred_at >= fromIso && e.occurred_at <= toIso);
  const bottles = inWin.filter((e) => e.type_id === "lana.feed" && e.payload.method === "Bottle");
  const ml = bottles.reduce((a, e) => a + (Number(e.payload.amount_ml) || 0), 0);
  const breast = inWin.filter((e) => e.type_id === "lana.feed" && e.payload.method === "Breast").length;
  const diapers = inWin.filter((e) => e.type_id === "lana.diaper").length;
  const naps = inWin.filter((e) => e.type_id === "lana.sleep");
  const napMin = naps.reduce((a, e) => a + minutesBetween(e.occurred_at, e.ended_at ?? toIso), 0);
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
        <Stat n={bottles.length + breast} l={ml ? `feeds · ${ml} ml` : "feeds"} />
        <Stat n={diapers} l="diapers" />
        <Stat n={naps.length ? fmtDuration(Math.round(napMin)) : 0} l={naps.length ? `${naps.length} nap${naps.length > 1 ? "s" : ""}` : "naps"} />
      </div>
    </section>
  );
}
