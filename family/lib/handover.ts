import type { EntryRow, HouseholdMember } from "@/lib/types";

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
/**
 * Whose workday the handover and the fridge plan follow: the breastfeeding parent
 * when one is marked (bottles while she is away), else the parent with work hours,
 * the one who leaves earliest first. A home where nobody breastfeeds, or where the
 * father is the one at work, still gets "since they left" and the plan to their
 * return. Nobody with work hours: no away parent.
 */
export function awayParent(members: HouseholdMember[]): HouseholdMember | null {
  const parent = (m: HouseholdMember) => m.role_id === "admin" || /\b(parent|mother|father|mum|mom|dad|mama|papa|baba)\b/i.test(m.relationship ?? "");
  const nursing = members.find((m) => m.breastfeeds);
  if (nursing) return nursing;
  const working = members.filter((m) => parent(m) && m.work_days.length > 0 && (m.work_from || m.work_to));
  working.sort((a, b) => (a.work_from ?? "99:99").localeCompare(b.work_from ?? "99:99"));
  return working[0] ?? null;
}

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
