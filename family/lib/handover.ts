import type { EntryRow } from "@/lib/types";

export interface WindowStats {
  bottles: number;
  ml: number;
  breast: number;
  diapers: number;
  naps: number;
  napMin: number;
}

/**
 * What happened between two instants: feeds and nappies by when they happened,
 * sleep by how much of it fell inside the window. A nap that began before the
 * window counts for the part after `fromIso`; one still running, or ending after
 * `toIso`, counts up to `toIso` only. So "while Mama was at work" neither loses
 * the nap she left during nor claims the evening's.
 */
export function windowStats(entries: EntryRow[], fromIso: string, toIso: string): WindowStats {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const inWin = entries.filter((e) => e.occurred_at >= fromIso && e.occurred_at <= toIso);
  const bottles = inWin.filter((e) => e.type_id === "lana.feed" && e.payload.method === "Bottle");
  const ml = bottles.reduce((a, e) => a + (Number(e.payload.amount_ml) || 0), 0);
  const breast = inWin.filter((e) => e.type_id === "lana.feed" && e.payload.method === "Breast").length;
  const diapers = inWin.filter((e) => e.type_id === "lana.diaper").length;
  let naps = 0;
  let napMin = 0;
  for (const e of entries) {
    if (e.type_id !== "lana.sleep") continue;
    const start = Date.parse(e.occurred_at);
    const end = e.ended_at ? Date.parse(e.ended_at) : to;
    const overlap = Math.min(end, to) - Math.max(start, from);
    if (overlap <= 0) continue;
    naps += 1;
    napMin += overlap / 60000;
  }
  return { bottles: bottles.length, ml, breast, diapers, naps, napMin: Math.round(napMin) };
}
