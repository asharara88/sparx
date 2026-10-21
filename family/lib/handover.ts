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
 * Whose workday the handover and the fridge plan follow. The candidates are the
 * breastfeeding parent when one is marked and has work days (bottles while she
 * is away; the hours default when she has none) and any parent with work days
 * and hours. Among them, whoever works today comes first (the callers show the
 * away state only for a parent who works today), the breastfeeding parent before
 * another, the one who leaves earliest before a later one. So a home where
 * nobody breastfeeds, where the nursing parent stays home, or where she is off
 * today while the father is at work, still gets "since they left" and the plan
 * to their return. Nobody with work days: no away parent.
 */
export function awayParent(members: HouseholdMember[]): HouseholdMember | null {
  return pickAway(members, (m) => m.works_today);
}

/**
 * The same choice for another day of the week (0 = Sunday): who is away
 * tomorrow, or on a day being looked back at. Two parents who work on
 * different days each get their own day, so the evening thaw reminder follows
 * whoever leaves tomorrow, not whoever left today.
 */
export function awayParentOn(members: HouseholdMember[], weekday: number): HouseholdMember | null {
  return pickAway(members, (m) => m.work_days.includes(weekday));
}

function pickAway(members: HouseholdMember[], worksThatDay: (m: HouseholdMember) => boolean): HouseholdMember | null {
  const parent = (m: HouseholdMember) => m.role_id === "admin" || /\b(parent|mother|father|mum|mom|dad|mama|papa|baba)\b/i.test(m.relationship ?? "");
  const candidates = members.filter((m) => m.work_days.length > 0 && ((m.breastfeeds ?? false) || (parent(m) && !!(m.work_from || m.work_to))));
  const rank = (m: HouseholdMember) => (worksThatDay(m) ? 0 : 2) + (m.breastfeeds ? 0 : 1);
  candidates.sort((a, b) => rank(a) - rank(b) || (a.work_from ?? "99:99").localeCompare(b.work_from ?? "99:99"));
  return candidates[0] ?? null;
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
