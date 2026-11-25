import type { EntryRow } from "@/lib/types";
import { fmtDuration } from "@/lib/time";
import { windowStats } from "@/lib/handover";

// Written out in full so Tailwind keeps all three.
const COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" };

/**
 * "Since Mama left" or "While Mama was at work": bottles, diapers, naps in that window.
 * `kinds` says which tiles to draw: all three for a baby; from 12 months only what the family
 * logged lately (R8), so a kind nobody logs never reads 0. Nothing to draw, no card.
 */
export function HandoverSince({ entries, kinds, fromIso, toIso, label }: { entries: EntryRow[]; kinds: { feeds: boolean; diapers: boolean; naps: boolean }; fromIso: string; toIso: string; label: string }) {
  const s = windowStats(entries, fromIso, toIso);
  const Stat = ({ n, l }: { n: string | number; l: string }) => (
    <div className="rounded-xl bg-[var(--card-2)] p-3 text-center">
      <p className="card-head">{n}</p>
      <p className="muted text-xs font-semibold">{l}</p>
    </div>
  );
  const tiles = [
    kinds.feeds ? <Stat key="f" n={s.bottles + s.breast} l={s.ml ? `feeds · ${s.ml} ml` : "feeds"} /> : null,
    kinds.diapers ? <Stat key="d" n={s.diapers} l="diapers" /> : null,
    kinds.naps ? <Stat key="n" n={s.naps ? fmtDuration(s.napMin) : 0} l={s.naps ? `${s.naps} nap${s.naps > 1 ? "s" : ""}` : "naps"} /> : null,
  ].filter(Boolean);
  if (!tiles.length) return null;
  return (
    <section className="card" aria-label={label}>
      <p className="muted text-xs font-semibold uppercase tracking-wide">{label}</p>
      <div className={`mt-2 grid ${COLS[tiles.length]} gap-2`}>{tiles}</div>
    </section>
  );
}
