/**
 * "{Name}'s day": what a family says about a child of 12 months or more that age and the log
 * cannot (milk on a clock, as a drink or not logged; naps; diapers or potty; whether milk is
 * stored), and what every screen makes of it. Home's rows, the strip, the child's tiles, the
 * tab bar, the + menu and the stored-milk notices all ask here, so they never disagree.
 *
 * With no day every answer is the rule the app had before the day existed, moved here and
 * not rewritten: a baby's home, a child with no birth date and a toddler's home that has not
 * saved a day read exactly as they did. New things are off unless a day turns them on.
 *
 * Pure: relative imports only, so the unit tests load it on its own, and never a
 * "use client" file, so a server page may call it while rendering.
 */
import { defaultNaps, isToddler, pumpingActive, stageOf } from "./stage.ts";
import { loggedLately } from "./logged.ts";
import { addDays, ymdInZone } from "./time.ts";
import { ageDays as daysOld } from "./norms.ts";
import { possessive } from "./names.ts";
import type { NapPattern } from "./child-insights.ts";

/** The ages the day is asked at, in months. */
export type Band = 12 | 18 | 24 | 36;

/** The first day of each band, in days since birth: the days stageOf().band flips, and the database's private.day_band. */
const BAND_FROM: Record<Band, number> = { 12: 366, 18: 548, 24: 731, 36: 1096 };

/** The four answers of "{Name}'s day", as care_subjects.settings.day keeps them. */
export interface SavedDay {
  v: 1;
  /** Milk feeds with a next-due time, milk as a drink with meals (logged, nothing due), or not logged. */
  milk: "clock" | "drink" | "off";
  /** Naps a day. */
  naps: 0 | 1 | 2;
  diapers: "diapers" | "both" | "potty" | "off";
  /** Pumped milk is kept in the fridge or freezer: the Milk tab and Pump. */
  stores_milk: boolean;
}

/** The answers alone: what the screen shows and subject_day_save takes. */
export type DayAnswers = Omit<SavedDay, "v">;

/** The band a child is in: 12 from day 366, 18 from 548, 24 from 731, 36 from 1096; null for a baby or no birth date. */
export function bandOf(ageDays: number | null): Band | null {
  if (ageDays == null || !isToddler(ageDays)) return null;
  const band = stageOf(ageDays).band;
  return band === "12-18" ? 12 : band === "18-24" ? 18 : band === "24-36" ? 24 : 36;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MILK: readonly unknown[] = ["clock", "drink", "off"];
const DIAPERS: readonly unknown[] = ["diapers", "both", "potty", "off"];

/** A day that reads whole, rebuilt from its checked answers; null for anything else. Age is not asked here. */
function shapeOf(raw: unknown): SavedDay | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  // The database takes the number 1 or the text "1" (private.subject_day compares the JSON value), so both pass here.
  // A number that only rounds to 1 as a double passes here and not there; only a hand-written update stores one.
  if (!((typeof d.v === "number" || typeof d.v === "string") && String(d.v) === "1")) return null;
  if (!MILK.includes(d.milk) || !DIAPERS.includes(d.diapers)) return null;
  if (d.naps !== 0 && d.naps !== 1 && d.naps !== 2) return null;
  if (typeof d.stores_milk !== "boolean") return null;
  return { v: 1, milk: d.milk as SavedDay["milk"], naps: d.naps, diapers: d.diapers as SavedDay["diapers"], stores_milk: d.stores_milk };
}

/**
 * The day as it is in force at an age: none for a baby, and potty answers read as diapers
 * under 18 months (potty is offered from day 548; only a corrected birth date gets there).
 */
function inForce(day: SavedDay | null, ageDays: number | null): SavedDay | null {
  const band = bandOf(ageDays);
  if (!day || band == null) return null;
  return band < 18 && (day.diapers === "both" || day.diapers === "potty") ? { ...day, diapers: "diapers" } : day;
}

/**
 * The saved day from a child's settings, or null for "no day". The same tests as the
 * database's private.subject_day, so the two agree on every day subject_day_save can store: a child of 12
 * months or more by the birth date stored now; `settings.day` an object with v 1 and four
 * good answers; and `saved_on` (the home's date as text) on or after birth + 366 days. A day
 * saved under a birth date that was later moved (a mistyped year at sign-up) never comes
 * into force by itself. Text is compared as text; nothing stored is parsed as a date.
 */
export function readDay(settings: unknown, ageDays: number | null, birthDate: string | null): SavedDay | null {
  if (!isToddler(ageDays) || !birthDate || !YMD.test(birthDate.slice(0, 10))) return null;
  if (!settings || typeof settings !== "object") return null;
  const raw = (settings as Record<string, unknown>).day;
  const day = shapeOf(raw);
  if (!day) return null;
  const savedOn = (raw as Record<string, unknown>).saved_on;
  if (typeof savedOn !== "string" || !YMD.test(savedOn) || savedOn < addDays(birthDate.slice(0, 10), BAND_FROM[12])) return null;
  return inForce(day, ageDays);
}

/**
 * The tab bar's Milk tab: gone only when a readable day says no milk is stored. `day` is
 * me().subjects[].day, which the database has already held against the child's age; the tab
 * bar cannot see the stash, so it follows the answer alone.
 */
export function milkTab(day: unknown): boolean {
  return shapeOf(day)?.stores_milk !== false;
}

/** What a screen knows when it asks for the plan. Every time is ISO or null for never. */
export interface DayFacts {
  /** Now, ms. */
  now: number;
  /** The home's date, YYYY-MM-DD, and its time zone. */
  today: string;
  tz: string;
  /** The entry type is in the home's list (home_summary's types). `note` is false only where Note is switched off; absent reads as there. */
  has: { meal: boolean; pump: boolean; potty: boolean; note?: boolean };
  /** The member looking breastfeeds. */
  breastfeeds: boolean;
  /** The newest pump, any day (home_summary's last["lana.pump"].occurred_at). */
  lastPumpAt: string | null;
  /** A bottle in the stash that is not used, not binned and not past its time (milk_list's fridge_count + freezer_count > 0). */
  inStock: boolean;
  /** The newest of each kind, any day (home_summary's last[...].occurred_at). */
  lastFeedAt: string | null;
  lastDiaperAt: string | null;
  lastMealAt: string | null;
  lastPottyAt: string | null;
  /** A breastfeed was logged lately (loggedLately on the newest feed whose method is Breast). */
  breastLately: boolean;
  /** napPattern's expected and napsToday, with the day's naps passed as `said`. */
  napExpected: boolean;
  napsToday: number;
}

/** What home_summary tells about the log, as far as the plan reads it. */
type SummaryFacts = { types: readonly { key: string }[]; last: Record<string, { occurred_at: string } | null | undefined> };

/**
 * The facts for dayPlan, read off home_summary and the last week's entries: one place, so
 * every screen asks the plan the same question. `summary` null (it failed to load) reads as
 * nothing known. The newest of each kind is its `occurred_at`, the time the rules moved here
 * always went by, not when a timer ended. A screen that fetches no stock or no week passes
 * `inStock: false` or an empty week, and then reads only the keys that do not rest on them.
 */
export function dayFacts(
  summary: SummaryFacts | null,
  x: { now: number; today: string; tz: string; breastfeeds: boolean; inStock: boolean; week: readonly { type_id: string; occurred_at: string; payload: Record<string, unknown> }[]; pattern: Pick<NapPattern, "expected" | "napsToday"> },
): DayFacts {
  const lastAt = (typeId: string) => summary?.last[typeId]?.occurred_at ?? null;
  const has = (key: string) => !!summary && summary.types.some((t) => t.key === key);
  return {
    now: x.now,
    today: x.today,
    tz: x.tz,
    has: { meal: has("meal"), pump: has("pump"), potty: has("potty"), note: has("note") },
    breastfeeds: x.breastfeeds,
    lastPumpAt: lastAt("lana.pump"),
    inStock: x.inStock,
    lastFeedAt: lastAt("lana.feed"),
    lastDiaperAt: lastAt("lana.diaper"),
    lastMealAt: lastAt("lana.meal"),
    lastPottyAt: lastAt("lana.potty"),
    breastLately: x.week.some((e) => e.type_id === "lana.feed" && e.payload.method === "Breast" && loggedLately(e.occurred_at, x.today, x.tz)),
    napExpected: x.pattern.expected,
    napsToday: x.pattern.napsToday,
  };
}

/** A row of Home's log card. `milk` is the Feed row named "Milk"; `meds` and `note` are link rows. */
export type RowKey = "feed" | "milk" | "sleep" | "diaper" | "diaper_potty" | "potty" | "meal" | "pump" | "meds" | "note";
/** A cell of Home's strip (lib/logged.ts stripCells draws them). */
export type CellKey = "woke" | "naps" | "feeds" | "diapers" | "potty" | "meals";
/** A tile of the child's day (components/DayStrip.tsx draws them). */
export type TileKey = "sleep" | "breastfeeds" | "bottles" | "milk" | "diapers" | "potty" | "meals";

export interface DayPlan {
  /** A day is in force. False: every key below is the rule from before the day existed. */
  saved: boolean;
  /** The milk answer; null with no day. */
  milk: SavedDay["milk"] | null;
  /** The diapers answer as it is in force (both and potty read as diapers under day 548 or without the Potty type); null with no day. */
  diapers: SavedDay["diapers"] | null;
  /** Milk feeds have a next-due time. With a day: the answer is the clock and a feed was logged lately. */
  milkClock: boolean;
  /** Milk is stored: the Milk tab, Pump in the + menu, the sheet's stash options. With a day, the answer. */
  storesMilk: boolean;
  /** The stored-milk notices speak (thaw, fridge low, the fridge plan, the countdown, the pumping nudge, the helper's "milk kept"). */
  milkNotices: boolean;
  /** Home's rows, top to bottom (homeRows). */
  rows: RowKey[];
  /** The strip's cells, four at most; fewer than two means no strip. Null: stripCells decides as before. */
  cells: CellKey[] | null;
  /** The child's tiles, four at most. Null: DayStrip's own four as before. */
  tiles: TileKey[] | null;
  /** Home's "since Mama left" tiles. */
  kinds: { feeds: boolean; diapers: boolean; naps: boolean };
  /** The Feeds card: drawn at all, and with the next-due headline. Null: feedCard decides as before. */
  feedCard: { show: boolean; clock: boolean } | null;
  /** The naps answer, for napPattern's `said`; null with no day. */
  napsSaid: SavedDay["naps"] | null;
  /** The usual naps a day by the answer, in place of the stage's range; null with no day (use stage.naps). */
  usualNaps: [number, number] | null;
  /** What the day turns on: the Potty type, the answers a toddler's forms gain, and Pump. */
  on: { potty: boolean; extras: boolean; pump: boolean };
}

/** The diapers answer once the home's types are known: potty needs its entry type, else it is diapers. */
const diapersWith = (day: SavedDay, hasPotty: boolean): SavedDay["diapers"] => (!hasPotty && (day.diapers === "both" || day.diapers === "potty") ? "diapers" : day.diapers);

/**
 * Home's rows. With no day, as always: Feed, Sleep, Diaper and a fourth that grows with the
 * child (Meal once the child eats, before that Pump for the parent who pumps while pumping
 * goes on, else Medicine). With a day, a toddler's four: Meal, Sleep, Diaper or Potty, Milk;
 * a slot the family does not use takes Medicine, then Note (where the Note type is on), in
 * slot order. Four rows, but where there are more free slots than fillers: a home that logs
 * neither diapers nor milk and has switched the Meal or the Note type off shows three.
 *
 * components/LanaNow.tsx calls this on the phone's clock (the Pump row fades two weeks after
 * the last pump); dayPlan().rows is the same list on the server's.
 */
export function homeRows(day: SavedDay | null, ageDays: number | null, f: Pick<DayFacts, "now" | "has" | "breastfeeds" | "lastPumpAt">): RowKey[] {
  const d = inForce(day, ageDays);
  if (!d) {
    // A child with no birth date is taken as 120 days old here, as stageFor always has.
    const fourth: RowKey = stageOf(ageDays ?? 120).solids && f.has.meal ? "meal" : f.breastfeeds && f.has.pump && pumpingActive(f.lastPumpAt, f.now, ageDays) ? "pump" : "meds";
    return ["feed", "sleep", "diaper", fourth];
  }
  const diapers = diapersWith(d, f.has.potty);
  const slots: (RowKey | null)[] = [
    f.has.meal ? "meal" : null,
    "sleep",
    diapers === "off" ? null : diapers === "both" ? "diaper_potty" : diapers === "potty" ? "potty" : "diaper",
    d.milk === "clock" ? "feed" : d.milk === "drink" ? "milk" : null,
  ];
  // Note opens the note's own form, so it fills a slot only where that type is on; Medicine is a screen of its own.
  const fillers: RowKey[] = f.has.note === false ? ["meds"] : ["meds", "note"];
  return slots.map((s) => s ?? fillers.shift() ?? null).filter((s): s is RowKey => s != null);
}

/**
 * Everything a screen needs to know about the child's day, built once per page. `day` is
 * readDay's answer (null for none); a day handed in for a baby is not read.
 *
 * With a day, an answer turns a kind on, and a count still needs that kind logged lately:
 * saving the suggested day never brings back a zero, and a family on a clock that stopped
 * logging milk gets no "Feed due now" from last week. Rows and tabs follow the answers alone.
 */
export function dayPlan(day: SavedDay | null, ageDays: number | null, f: DayFacts): DayPlan {
  const toddler = isToddler(ageDays);
  const pumping = pumpingActive(f.lastPumpAt, f.now, ageDays);
  const lately = (at: string | null) => loggedLately(at, f.today, f.tz);
  const d = inForce(day, ageDays);
  if (!d) {
    // Stored milk only where milk is stored: a toddler's home with nothing in stock and no
    // pump in 14 days gets no fridge notices. A baby's home always has them.
    const stored = !toddler || f.inStock || pumping;
    return {
      saved: false,
      milk: null,
      diapers: null,
      milkClock: !toddler,
      storesMilk: stored,
      milkNotices: stored,
      rows: homeRows(null, ageDays, f),
      cells: null,
      tiles: null,
      // A toddler's tiles only for what the family logs; a baby's all three. Naps by the strip's rule.
      kinds: { feeds: !toddler || lately(f.lastFeedAt), diapers: !toddler || lately(f.lastDiaperAt), naps: !toddler || f.napExpected || f.napsToday > 0 },
      feedCard: null,
      napsSaid: null,
      usualNaps: null,
      on: { potty: false, extras: false, pump: true },
    };
  }
  const diapers = diapersWith(d, f.has.potty);
  const fed = lately(f.lastFeedAt);
  const milkClock = d.milk === "clock" && fed;
  const drink = d.milk === "drink" && fed;
  const naps = d.naps > 0 || f.napsToday > 0;
  const diaper = (diapers === "diapers" || diapers === "both") && lately(f.lastDiaperAt);
  const potty = (diapers === "both" || diapers === "potty") && lately(f.lastPottyAt);
  const meals = lately(f.lastMealAt);
  const four = <K>(keys: (K | false)[]) => keys.filter((k): k is K => k !== false).slice(0, 4);
  return {
    saved: true,
    milk: d.milk,
    diapers,
    milkClock,
    storesMilk: d.stores_milk,
    // The answer keeps the tab; the notices still stop 14 days after the last pump with nothing in stock.
    milkNotices: d.stores_milk && (f.inStock || pumping),
    rows: homeRows(d, ageDays, f),
    // A drink has no count on the strip: no feeds cell without the clock.
    cells: four<CellKey>(["woke", naps && "naps", milkClock && "feeds", diaper && "diapers", potty && "potty", meals && "meals"]),
    tiles: four<TileKey>(["sleep", milkClock && f.breastLately && "breastfeeds", milkClock && "bottles", drink && "milk", diaper && "diapers", potty && "potty", meals && "meals"]),
    kinds: { feeds: milkClock || drink, diapers: diaper, naps },
    feedCard: { show: milkClock || drink, clock: milkClock },
    napsSaid: d.naps,
    // [0, 1] for none, so the nap line says "no nap" and never "yet".
    usualNaps: d.naps === 0 ? [0, 1] : [d.naps, d.naps],
    on: { potty: diapers === "both" || diapers === "potty", extras: true, pump: d.stores_milk },
  };
}

/** A type row as far as the gate reads it. A row may have no settings at all: that is "no needs". */
type Gated = { settings?: { needs?: unknown } | null };
const needsOf = (t: object): string => {
  const needs = (t as Gated).settings?.needs;
  return needs == null ? "" : String(needs);
};

/**
 * The gate alone: the same objects, less a row whose `settings.needs` the day has not
 * turned on. The Entry types screen takes this and nothing more, so what it saves back to
 * the shared row is the row as stored. The same rule as home_summary's types.
 */
export function typesOn<T extends object>(types: readonly T[], on: DayPlan["on"]): T[] {
  return types.filter((t) => {
    const needs = needsOf(t);
    return needs === "" || (needs === "potty" && on.potty);
  });
}

/**
 * The entry types a home's forms and the helper offer for new entries: the gate, and every
 * other object as given. `keep` is the payload of an entry being edited: a type an entry
 * already has is never dropped, so with it the rows given (the entry's own) all stay.
 */
export function typesForDay<T extends object>(types: readonly T[], plan: Pick<DayPlan, "saved" | "milk" | "storesMilk" | "on">, opts: { keep?: Record<string, unknown> } = {}): T[] {
  return opts.keep ? [...types] : typesOn(types, plan.on);
}

/** Potty entries that count on the strip and the tiles: a wee or a poo, not a try or an accident. */
export function pottyCount(entries: readonly { type_id: string; payload: Record<string, unknown> }[]): number {
  return entries.filter((e) => e.type_id === "lana.potty" && (e.payload.kind === "Wee" || e.payload.kind === "Poo")).length;
}

/** Of the home's last 7 days (today and the 6 before), how many have an entry of any kind. */
export function loggedDays(entries: readonly { occurred_at: string }[], today: string, tz: string): number {
  const from = addDays(today, -6);
  const days = new Set<string>();
  for (const e of entries) {
    const at = Date.parse(e.occurred_at);
    if (!Number.isFinite(at)) continue;
    const day = ymdInZone(new Date(at), tz);
    if (day >= from && day <= today) days.add(day);
  }
  return days.size;
}

/** The answers the screen opens on, and where they came from (the line under the title follows it). */
export interface DaySuggestion extends DayAnswers {
  /** "saved": the saved day as it is; "log": the last week moved it; "age": a start for the age. */
  from: "saved" | "log" | "age";
}

/**
 * The answers "{Name}'s day" opens on. `logged` is loggedDays() at sign-up and from an
 * offer, and null when the screen was opened from About the child, where a saved day is
 * shown as it is. The log speaks only when 3 or more of the last 7 days have entries.
 *
 * With a day saved every answer starts from the saved one; the log may then move it, but a
 * saved "stored milk: yes" is never set to no, and the naps move only on 3 or more days
 * with a sleep logged (the family can say what age and the log cannot). With no day: from
 * the log where it speaks, else by age (a drink, never the clock; the naps Home already
 * expects; diapers until three; no stored milk). Potty is never filled in unless logged.
 * A bottle in stock is always "stored milk: yes": the screen does not ask then.
 *
 * `pattern` is napPattern over the last week without `said`; `f` the same facts dayPlan takes.
 */
export function suggestDay(ageDays: number, f: DayFacts, pattern: NapPattern, saved: SavedDay | null, logged: number | null): DaySuggestion {
  const band = bandOf(ageDays) ?? 12;
  const was = inForce(saved, ageDays);
  const lately = (at: string | null) => loggedLately(at, f.today, f.tz);
  // The naps Home expects with nothing logged: two before 15 months, one from 15, none from three.
  const napsByAge: SavedDay["naps"] = band === 36 ? 0 : defaultNaps(ageDays) >= 2 ? 2 : 1;
  if (logged == null || logged < 3) {
    if (was) return { milk: was.milk, naps: was.naps, diapers: was.diapers, stores_milk: was.stores_milk || f.inStock, from: "saved" };
    return { milk: "drink", naps: napsByAge, diapers: band === 36 ? "off" : "diapers", stores_milk: f.inStock, from: "age" };
  }
  const fed = lately(f.lastFeedAt);
  const diaper = lately(f.lastDiaperAt);
  const potty = band >= 18 && lately(f.lastPottyAt);
  const napsByLog: SavedDay["naps"] = !pattern.expected ? 0 : (pattern.perDay ?? napsByAge) >= 2 ? 2 : 1;
  // A pattern made from the family's own answer is not the log speaking.
  const napsKnown = pattern.toddler && !pattern.said && (!was || pattern.evidenceDays >= 3);
  return {
    milk: !fed ? "off" : was && was.milk !== "off" ? was.milk : "drink",
    naps: napsKnown ? napsByLog : was ? was.naps : napsByAge,
    diapers: diaper && potty ? "both" : potty ? "potty" : diaper ? "diapers" : "off",
    stores_milk: !!was?.stores_milk || f.inStock || pumpingActive(f.lastPumpAt, f.now, ageDays),
    from: "log",
  };
}

const OFFER_AGE: Record<Band, string> = { 12: "one", 18: "18 months", 24: "two", 36: "three" };

/**
 * Home's line that offers the day at 12, 18, 24 and 36 months, or null. Pending while the
 * child's band is above the last one settled (`settings.day_asked`, set by Save and by
 * "Keep it as it is"), for 30 days from the later of the band's first day and the day the
 * child's row was made; then it ends by itself. `day_asked` counts only when
 * `day_asked_on` is on or after that band's first day by the birth date stored now, so an
 * answer given under a mistyped birth date does not swallow the offer at the true age.
 *
 * `early` is true on its first 7 days, when the line sits ahead of "A vaccine is due";
 * after that it sits behind it. The caller shows it to admins only, never while viewing as
 * someone else and never on the simple screen. `createdAt` is the child's row (ISO),
 * `today` and `tz` the home's, `their` the child's pronoun ("her", "his", "their").
 */
export function dayOffer(c: { settings: unknown; birthDate: string | null; createdAt: string | null; today: string; tz: string; name: string; their: string }): { band: Band; words: string; early: boolean } | null {
  const birth = c.birthDate?.slice(0, 10);
  if (!birth || !YMD.test(birth) || !YMD.test(c.today)) return null;
  const band = bandOf(daysOld(birth, c.today));
  if (band == null) return null;
  const s = (c.settings && typeof c.settings === "object" ? c.settings : {}) as Record<string, unknown>;
  const said = s.day_asked;
  const on = s.day_asked_on;
  const asked = (said === 12 || said === 18 || said === 24 || said === 36) && typeof on === "string" && YMD.test(on) && on >= addDays(birth, BAND_FROM[said]) ? said : 0;
  if (band <= asked) return null;
  const began = addDays(birth, BAND_FROM[band]);
  const made = c.createdAt && Number.isFinite(Date.parse(c.createdAt)) ? ymdInZone(new Date(c.createdAt), c.tz) : null;
  // A family that joined once the band had begun was never asked at the birthday: it sets the day up.
  const joined = made != null && made >= began;
  const day = daysOld(joined ? made : began, c.today) + 1;
  if (day > 30) return null;
  return { band, words: joined ? `Set up ${possessive(c.name)} day` : `${c.name} is ${OFFER_AGE[band]}. Look at ${c.their} day`, early: day <= 7 };
}
