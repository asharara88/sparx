/**
 * The pure part of the helper's writes (lib/assistant/tools.ts): turning what the member said
 * ("Wafa", "the 120 from Saturday", "Calpol", "her 4 month jabs") into the one row a confirm
 * card will change, or into a question when it could be more than one. No database, no model:
 * the tools fetch the lists and the confirm card writes; this only matches and merges.
 * Imports stay relative with .ts so the unit tests load it directly.
 */

export type Match<T> = { ok: true; item: T } | { ok: false; error: "unknown" | "ambiguous"; options: T[] };

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A household member by what someone called them: the whole name, else the first name, else
 * the start of a name ("Lil" → Lilly). "me", "I" and "myself" are the member asking. Two members
 * who both fit is a question, never a guess.
 */
export function matchMember<T extends { id: string; name: string }>(people: T[], said: unknown, meId?: string): Match<T> {
  const q = norm(said);
  if (!q) return { ok: false, error: "unknown", options: people };
  if (meId && /^(me|i|myself|mine)$/.test(q)) {
    const self = people.find((p) => p.id === meId);
    if (self) return { ok: true, item: self };
  }
  const tiers: ((p: T) => boolean)[] = [
    (p) => norm(p.name) === q,
    (p) => norm(p.name).split(" ")[0] === q,
    (p) => norm(p.name).startsWith(q) || norm(p.name).split(" ").some((w) => w.startsWith(q) && q.length >= 3),
  ];
  for (const fits of tiers) {
    const hits = people.filter(fits);
    if (hits.length === 1) return { ok: true, item: hits[0] };
    if (hits.length > 1) return { ok: false, error: "ambiguous", options: hits };
  }
  return { ok: false, error: "unknown", options: people };
}

/** A medicine on the child's list by name ("calpol", "vitamin d"). */
export function matchMedicine<T extends { id: string; name: string }>(meds: T[], said: unknown): Match<T> {
  const q = norm(said);
  if (!q) return meds.length === 1 ? { ok: true, item: meds[0] } : { ok: false, error: meds.length ? "ambiguous" : "unknown", options: meds };
  const exact = meds.filter((m) => norm(m.name) === q);
  if (exact.length === 1) return { ok: true, item: exact[0] };
  const part = meds.filter((m) => norm(m.name).includes(q) || q.includes(norm(m.name)));
  if (part.length === 1) return { ok: true, item: part[0] };
  if (part.length > 1) return { ok: false, error: "ambiguous", options: part };
  // The words in any order ("drops of vitamin d" for "Vitamin D drops"): every word said that
  // is not a filler is a word of the name, or the start of one.
  const filler = new Set(["of", "the", "her", "his", "some", "a", "an", "dose", "doses", "ml", "drop"]);
  const heard = q.split(" ").filter((w) => w && !filler.has(w) && !/^\d/.test(w));
  const byWords = heard.length ? meds.filter((m) => heard.every((w) => norm(m.name).split(" ").some((x) => x === w || (w.length >= 3 && x.startsWith(w))))) : [];
  if (byWords.length === 1) return { ok: true, item: byWords[0] };
  if (byWords.length > 1) return { ok: false, error: "ambiguous", options: byWords };
  return { ok: false, error: "unknown", options: meds };
}

export interface Bottle {
  id: string;
  amount_ml: number;
  location: string;
  pumped_at: string;
  expired?: boolean;
  thawed_at?: string | null;
  warmed_at?: string | null;
}

/**
 * A bottle in the stash from what was said: its amount, where it is, the day it was pumped
 * ("YYYY-MM-DD", household day), or its id. With nothing said and one bottle, that one; else
 * ask. "The expired one" (expired true) keeps only bottles past their time; otherwise the
 * caller passes the bottles that may take the action (an expired bottle can only be binned).
 */
export function matchBottle(bottles: Bottle[], hint: { id?: unknown; amount_ml?: unknown; location?: unknown; pumped_on?: unknown; expired?: unknown }, dayOf: (iso: string) => string): Match<Bottle> {
  const id = String(hint.id ?? "").trim().toLowerCase();
  if (id) {
    const b = bottles.find((x) => x.id === id || (id.length >= 6 && x.id.startsWith(id)));
    return b ? { ok: true, item: b } : { ok: false, error: "unknown", options: bottles };
  }
  let list = bottles;
  if (hint.expired === true) list = list.filter((b) => b.expired);
  const ml = Number(hint.amount_ml);
  if (Number.isFinite(ml) && ml > 0) list = list.filter((b) => b.amount_ml === Math.round(ml));
  const loc = norm(hint.location);
  if (loc) list = list.filter((b) => b.location === loc);
  const day = String(hint.pumped_on ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) list = list.filter((b) => dayOf(b.pumped_at) === day);
  if (list.length === 1) return { ok: true, item: list[0] };
  return { ok: false, error: list.length ? "ambiguous" : "unknown", options: list.length ? list : bottles };
}

/** What a bottle can be moved to (milk_move's p_action), by the words people use. */
export function bottleAction(said: unknown): "fridge" | "warmed" | "used" | "binned" | null {
  const q = norm(said);
  if (/^(fridge|thaw|thawed|defrost|defrosted|to the fridge|move to fridge)$/.test(q)) return "fridge";
  if (/^(warm|warmed|warming|heated)$/.test(q)) return "warmed";
  if (/^(used|use|drank|given|finished|fed)$/.test(q)) return "used";
  if (/^(bin|binned|throw|thrown|thrown away|discard|discarded|tossed|poured away|expired)$/.test(q)) return "binned";
  return null;
}

export interface VaccineItem {
  id: string;
  visit: string;
  vaccine: string;
  dose?: string | null;
  status: string;
  due_on?: string | null;
}

/**
 * Which vaccines were given, from what was said: a visit ("4 months", "the 4 month jabs"),
 * one vaccine by name ("rotavirus"), or nothing (the earliest visit that is due or overdue).
 * Only vaccines not recorded yet are offered; a visit given in full says so.
 */
export function matchVaccines(items: VaccineItem[], said: unknown): { ok: true; visit: string; items: VaccineItem[] } | { ok: false; error: "unknown" | "already_given" | "nothing_due" | "which_visit"; visits: string[] } {
  const open = items.filter((v) => v.status !== "given");
  const visits = [...new Set(items.map((v) => v.visit))];
  const q = norm(said).replace(/\b(jabs?|vaccines?|vaccinations?|shots?|visit|the|her|his|check ?up)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!q) {
    // "She had her jabs": the one visit that is due or overdue. With two or more open (an
    // earlier visit never recorded), which one is a question, never the earliest by default.
    const dueVisits = [...new Set(open.filter((v) => v.status === "overdue" || v.status === "due").map((v) => v.visit))];
    if (!dueVisits.length) return { ok: false, error: "nothing_due", visits };
    if (dueVisits.length > 1) return { ok: false, error: "which_visit", visits: dueVisits };
    return { ok: true, visit: dueVisits[0], items: open.filter((v) => v.visit === dueVisits[0]) };
  }
  // "4 month" / "4 months" / "four months": compare on the number and the unit's first letter.
  const words: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", eight: "8", nine: "9", ten: "10", twelve: "12" };
  const key = (s: string) =>
    norm(s)
      .replace(/\b(one|two|three|four|five|six|eight|nine|ten|twelve)\b/g, (w) => words[w])
      .replace(/\b(\d+)\s*(weeks?|w|wk)\b/g, "$1w")
      .replace(/\b(\d+)\s*(months?|mo|m)\b/g, "$1m")
      .replace(/\b(\d+)\s*(years?|y|yr)\b/g, "$1y")
      .replace(/\s+/g, " ")
      .trim();
  const k = key(q);
  // An age said one way matches a visit written another ("1 year" is "12 months", "8 weeks"
  // is "2 months"), compared whole: "1 year" never matches "10 to 11 years".
  const months = (x: string): number | null => {
    const m = /^(\d+)(w|m|y)$/.exec(x);
    if (!m) return null;
    const n = Number(m[1]);
    return m[2] === "y" ? n * 12 : m[2] === "m" ? n : Math.round(n / 4.345);
  };
  const visit =
    visits.find((v) => key(v) === k) ??
    (() => {
      const want = months(k);
      if (want === null) return undefined;
      const same = visits.filter((v) => months(key(v)) === want);
      return same.length === 1 ? same[0] : undefined;
    })();
  if (visit) {
    const left = open.filter((v) => v.visit === visit);
    return left.length ? { ok: true, visit, items: left } : { ok: false, error: "already_given", visits };
  }
  // By name: the whole phrase inside the vaccine's name, else every word said is one of its
  // words (or the start of one), so "hepatitis a" never matches "Hepatitis B".
  const tokens = (x: string) => norm(x).split(" ").filter(Boolean);
  const heard = tokens(q);
  const fits = (v: VaccineItem) => (q.length >= 4 && norm(v.vaccine).includes(q)) || (heard.length > 0 && heard.every((w) => tokens(v.vaccine).some((x) => x === w || (w.length >= 4 && x.startsWith(w)))));
  const byName = items.filter(fits);
  if (byName.length) {
    const left = byName.filter((v) => v.status !== "given");
    if (!left.length) return { ok: false, error: "already_given", visits };
    // A vaccine given at more than one visit (MMR at 12 and 18 months) with more than one still
    // open: which dose it was is a question, never the first in the schedule.
    const open = [...new Set(left.map((v) => v.visit))];
    if (open.length > 1) return { ok: false, error: "which_visit", visits: open };
    return { ok: true, visit: open[0], items: left.filter((v) => v.visit === open[0]) };
  }
  return { ok: false, error: "unknown", visits };
}

export interface EntryNow {
  occurred_at: string;
  ended_at: string | null;
  payload: Record<string, unknown>;
  note: string | null;
}

/**
 * An entry after a change the member asked for, as care_entry_update needs it: that function
 * writes every column it is given (an end left out would be cleared), so whatever was not
 * changed is carried over as it is. `ended_at: ""` clears the end ("she's still asleep").
 * Payload changes merge into the old payload; a key set to null is dropped.
 */
export function mergeEntry(
  now: EntryNow,
  change: { occurred_at?: string; ended_at?: string | ""; payload?: Record<string, unknown>; note?: string | null },
  fields: { key: string; show_if?: Record<string, string> }[] = [],
): { ok: true; next: EntryNow; changed: string[] } | { ok: false; error: "end_before_start" | "nothing_changed" } {
  const payload: Record<string, unknown> = { ...now.payload };
  delete payload.auto_end;
  const changed: string[] = [];
  for (const [k, v] of Object.entries(change.payload ?? {})) {
    if (v === null || v === "") {
      if (k in payload) {
        delete payload[k];
        changed.push(k);
      }
    } else if (String(payload[k]) !== String(v)) {
      payload[k] = v;
      changed.push(k);
    }
  }
  // A field the entry's choices now hide goes, as the edit sheet drops it: a feed changed from
  // Bottle to Breast keeps no amount_ml (fields' show_if, e.g. amount_ml shows for Bottle).
  for (const f of fields) {
    if (f.show_if && f.key in payload && !Object.entries(f.show_if).every(([k, v]) => payload[k] === v)) {
      delete payload[f.key];
      if (!changed.includes(f.key)) changed.push(f.key);
    }
  }
  const occurred_at = change.occurred_at ?? now.occurred_at;
  if (change.occurred_at && Date.parse(change.occurred_at) !== Date.parse(now.occurred_at)) changed.push("start");
  // A bottle from Home is saved with its end at its start: moving it moves both, as the edit
  // sheet does, so "it was at 8:00" never leaves an end at the old time.
  const instant = now.ended_at !== null && Date.parse(now.ended_at) === Date.parse(now.occurred_at);
  const ended_at = change.ended_at === "" ? null : change.ended_at ?? (instant && change.occurred_at ? occurred_at : now.ended_at);
  if (change.ended_at !== undefined && (ended_at ? Date.parse(ended_at) : null) !== (now.ended_at ? Date.parse(now.ended_at) : null)) changed.push("end");
  const note = change.note === undefined ? now.note : change.note?.trim() || null;
  if (change.note !== undefined && (note ?? "") !== (now.note ?? "")) changed.push("note");
  if (ended_at && Date.parse(ended_at) < Date.parse(occurred_at)) return { ok: false, error: "end_before_start" };
  if (!changed.length) return { ok: false, error: "nothing_changed" };
  return { ok: true, next: { occurred_at, ended_at, payload, note }, changed };
}
