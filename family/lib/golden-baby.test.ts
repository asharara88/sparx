/**
 * The golden net for babies. It calls the app's rules for a child under 12 months (and for
 * a child with no birth date) at many ages, logs and hours, and compares each result with
 * what the same call returned on main, stored in lib/fixtures/golden-baby.json.
 *
 * The rule: every key stored in the fixture must still be there and equal. A key that is
 * only in the fresh result is allowed, so a later change may add a field. Lists must have
 * the same length and the same items in the same places. One field is held tighter: a
 * usual range or a row of the age check that has no note is stored with "note": null, so a
 * note added later to a baby's row counts as a change, not as a new key.
 *
 * Every call goes through lib/fixtures/golden-calls.ts. When a rule takes a new argument,
 * it is added there; this file and the fixture stay as they are.
 *
 * The fixture was written once, with GOLDEN_WRITE=1 npm test, from main's logic. It is not
 * written again: a stored result changes only by hand, for a named exception. With the
 * fixture in place GOLDEN_WRITE=1 writes nothing and fails.
 *
 * The clock is fixed (17 November 2026 in Asia/Dubai) and the logs are built by plain
 * arithmetic below. While the cases are built, reading the wall clock or a random number
 * throws.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as calls from "./fixtures/golden-calls.ts";
import type { Child, Clock, Home } from "./fixtures/golden-calls.ts";
import type { EntryRow, Me } from "./types.ts";
import type { SituationInput } from "./assistant/situation-format.ts";

// ---- comparing ------------------------------------------------------------------------------

const show = (v: unknown) => {
  const s = JSON.stringify(v);
  return s === undefined ? "nothing" : s.length > 160 ? `${s.slice(0, 157)}...` : s;
};

/**
 * What differs between a stored value and a fresh one, as one line each; empty when the
 * fresh value still holds everything stored. Keys only in `fresh` are fine. Lists compare
 * by place and must have the same length.
 */
function containsStored(stored: unknown, fresh: unknown, path = ""): string[] {
  const at = path || "(top)";
  if (Array.isArray(stored)) {
    if (!Array.isArray(fresh)) return [`${at}: stored a list, now ${show(fresh)}`];
    const out: string[] = [];
    if (stored.length !== fresh.length) out.push(`${at}: stored ${stored.length} items, now ${fresh.length}`);
    for (let i = 0; i < Math.min(stored.length, fresh.length); i++) out.push(...containsStored(stored[i], fresh[i], `${path}[${i}]`));
    return out;
  }
  if (stored !== null && typeof stored === "object") {
    if (fresh === null || typeof fresh !== "object" || Array.isArray(fresh)) return [`${at}: stored ${show(stored)}, now ${show(fresh)}`];
    const out: string[] = [];
    for (const [k, v] of Object.entries(stored)) {
      const here = path ? `${path}.${k}` : k;
      if (!Object.hasOwn(fresh, k)) out.push(`${here}: stored ${show(v)}, now missing`);
      else out.push(...containsStored(v, (fresh as Record<string, unknown>)[k], here));
    }
    return out;
  }
  return stored === fresh ? [] : [`${at}: stored ${show(stored)}, now ${show(fresh)}`];
}

/** A usual range, or a row of the age check, with its note spelled out: no note is null. */
const noted = <T>(row: T): T => (row !== null && typeof row === "object" && !Array.isArray(row) ? { ...row, note: (row as { note?: string | null }).note ?? null } : row);
/** The usual ranges for an age, each with its note spelled out. */
const notedRanges = (ranges: object | null) => (ranges ? Object.fromEntries(Object.entries(ranges).map(([k, v]) => [k, noted(v)])) : null);

test("containsStored: an added key passes", () => {
  assert.deepEqual(containsStored({ a: 1, b: { c: "x" } }, { a: 1, b: { c: "x", d: true }, e: [1] }), []);
  assert.deepEqual(containsStored([{ a: 1 }, { a: 2 }], [{ a: 1, more: null }, { a: 2 }]), []);
  assert.deepEqual(containsStored(null, null), []);
  assert.deepEqual(containsStored({}, { anything: 1 }), []);
});

test("containsStored: a changed value fails, and says where", () => {
  assert.deepEqual(containsStored({ a: 1, b: { c: "x" } }, { a: 1, b: { c: "y" } }), ['b.c: stored "x", now "y"']);
  assert.deepEqual(containsStored({ rows: [{ low: 6 }] }, { rows: [{ low: 5 }] }), ["rows[0].low: stored 6, now 5"]);
  assert.equal(containsStored({ a: null }, { a: 0 }).length, 1);
  assert.equal(containsStored({ a: 1 }, { a: "1" }).length, 1);
  assert.equal(containsStored({ a: false }, { a: null }).length, 1);
});

test("containsStored: a removed key fails", () => {
  assert.deepEqual(containsStored({ a: 1, b: 2 }, { a: 1 }), ["b: stored 2, now missing"]);
  assert.equal(containsStored({ a: { b: { c: 1 } } }, { a: { b: {} } }).length, 1);
  assert.equal(containsStored({ a: null }, {}).length, 1, "a stored null is still a stored key");
});

test("containsStored: a shorter or a longer list fails", () => {
  assert.deepEqual(containsStored([1, 2, 3], [1, 2]), ["(top): stored 3 items, now 2"]);
  assert.deepEqual(containsStored([1, 2], [1, 2, 3]), ["(top): stored 2 items, now 3"]);
  assert.deepEqual(containsStored({ tips: [] }, { tips: [{ level: "red" }] }), ["tips: stored 0 items, now 1"]);
  assert.equal(containsStored([1, 2], [2, 1]).length, 2, "a list compares by place");
});

test("containsStored: a list, an object and a plain value are never taken for each other", () => {
  assert.equal(containsStored([], {}).length, 1);
  assert.equal(containsStored({}, []).length, 1);
  assert.equal(containsStored({ a: 1 }, null).length, 1);
  assert.equal(containsStored(null, { a: 1 }).length, 1);
  assert.equal(containsStored("x", ["x"]).length, 1);
});

test("a note that was not there is a change: a row with no note is stored with note null", () => {
  const through = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;
  const storedRow = through(noted({ low: 6, high: 8, flagLow: true, note: undefined }));
  assert.deepEqual(storedRow, { low: 6, high: 8, flagLow: true, note: null });
  assert.deepEqual(containsStored(storedRow, through(noted({ low: 6, high: 8, flagLow: true }))), []);
  assert.deepEqual(containsStored(storedRow, through(noted({ low: 6, high: 8, flagLow: true, note: "Something new for a baby." }))), ['note: stored null, now "Something new for a baby."']);
  assert.deepEqual(containsStored(through(noted({ key: "wet", value: "6" })), through(noted({ key: "wet", value: "6", note: "New." }))), ['note: stored null, now "New."']);
  assert.deepEqual(containsStored(through(noted({ low: 4, note: "Plus solids." })), through(noted({ low: 4 }))), ['note: stored "Plus solids.", now null']);
  assert.deepEqual(through(notedRanges({ feeds: { low: 6 }, label: "3 to 6 months" })), { feeds: { low: 6, note: null }, label: "3 to 6 months" }, "only a range gets a note; a plain value is left alone");
  assert.equal(notedRanges(null), null);
});

// ---- no wall clock, no dice -------------------------------------------------------------------

/**
 * Runs `work` with every way of reading the wall clock shut: Date.now(), new Date() and
 * Date() with nothing given, and a date format asked to format no date. Math.random() is
 * shut too. Each throws, so a rule that reads one of them fails at once and not on the first
 * day the calendar moves past the fixed clock.
 */
async function withNoWallClock<T>(work: () => Promise<T> | T): Promise<T> {
  const RealDate = Date;
  const realRandom = Math.random;
  const proto = Intl.DateTimeFormat.prototype;
  const realFormat = Object.getOwnPropertyDescriptor(proto, "format")!;
  const realParts = proto.formatToParts;
  const stop = (what: string): never => {
    throw new Error(`${what} was read while the golden cases were built: pass the instant through lib/fixtures/golden-calls.ts`);
  };
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) => (args.length ? (Reflect.construct(target, args, newTarget) as object) : stop("the wall clock, by new Date()")),
    apply: () => stop("the wall clock, by Date()"),
    get: (target, key) => (key === "now" ? () => stop("the wall clock, by Date.now()") : (Reflect.get(target, key) as unknown)),
  });
  Math.random = () => stop("a random number");
  Object.defineProperty(proto, "format", {
    configurable: true,
    get(this: Intl.DateTimeFormat) {
      const format = (realFormat.get as (this: Intl.DateTimeFormat) => (d?: Date | number) => string).call(this);
      return (d?: Date | number) => (d === undefined ? stop("the wall clock, by a date format given no date") : format(d));
    },
  });
  proto.formatToParts = function (this: Intl.DateTimeFormat, d?: Date | number) {
    return d === undefined ? stop("the wall clock, by a date format given no date") : realParts.call(this, d);
  };
  try {
    return await work();
  } finally {
    globalThis.Date = RealDate;
    Math.random = realRandom;
    Object.defineProperty(proto, "format", realFormat);
    proto.formatToParts = realParts;
  }
}

test("the wall clock and the dice are shut while cases are built, and open again after", async () => {
  const before = Date;
  await withNoWallClock(() => {
    assert.throws(() => Date.now(), /wall clock/);
    assert.throws(() => new Date(), /wall clock/);
    assert.throws(() => (Date as unknown as () => string)(), /wall clock/);
    assert.throws(() => new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(), /wall clock/);
    assert.throws(() => new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).formatToParts(), /wall clock/);
    assert.throws(() => Math.random(), /random/);
    // A given instant still reads as itself.
    assert.equal(new Date(0).toISOString(), "1970-01-01T00:00:00.000Z");
    assert.equal(new Date("2026-11-17T09:00:00Z").getTime(), Date.UTC(2026, 10, 17, 9));
    assert.equal(Date.parse("2026-11-17"), Date.UTC(2026, 10, 17));
    assert.ok(new Date(0) instanceof Date);
    assert.equal(new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(0), "1970-01-01");
    assert.equal(Number(new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(0)).find((p) => p.type === "hour")?.value), 0);
  });
  assert.equal(Date, before);
  assert.equal(typeof Date.now(), "number");
  assert.equal(typeof new Date().getTime(), "number");
  assert.equal(typeof new Intl.DateTimeFormat("en-CA").format(), "string");
  assert.equal(typeof Math.random(), "number");
  await assert.rejects(withNoWallClock(async () => new Date()), /wall clock/);
  assert.equal(Date, before, "open again after a failure too");
});

// ---- the fixed clock --------------------------------------------------------------------------

const TZ = "Asia/Dubai";
const TODAY = "2026-11-17";
const MIN = 60_000;
/** Minutes in a day. Every time below is a number of minutes from 00:00 on TODAY in Dubai; earlier days are negative. */
const DAY = 1440;
/** 00:00 on 17 November 2026 in Dubai as an instant. Dubai is 4 hours ahead of UTC all year. */
const DAY0 = Date.UTC(2026, 10, 16, 20, 0);
/** The three times of day every log is looked at, in minutes after midnight. */
const HOUR_LIST: [string, number][] = [["0730", 7 * 60 + 30], ["1300", 13 * 60], ["2130", 21 * 60 + 30]];
const HOURS: Record<string, number> = Object.fromEntries(HOUR_LIST);
/** 13:00, when the hand-written cases are read. */
const ONE = 13 * 60;

const AGES = [0, 4, 5, 13, 14, 30, 31, 41, 42, 83, 84, 91, 92, 111, 112, 119, 120, 149, 150, 165, 167, 168, 179, 180, 182, 183, 250, 273, 274, 300, 364, 365];
/** The ages that also get the log of mis-entries, the helper's own tools, the forecast with a parent at work, and the sentences for a boy and for a child with no sex or no name. */
const SOME_AGES: (number | null)[] = [5, 92, 165, 250, 365, null];
/** The feed type's own gap, minutes, as the database seeds it. */
const TYPE_GAP_MIN = 180;

const pad = (n: number) => String(n).padStart(2, "0");
/** day -1 at "19:30" as minutes from DAY0. */
const at = (day: number, hhmm: string) => day * DAY + Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** So many minutes before 13:00 today. */
const ago = (min: number) => ONE - min;
const iso = (t: number) => new Date(DAY0 + Math.round(t * MIN)).toISOString();
const ymd = (day: number) => new Date(Date.UTC(2026, 10, 17 + day)).toISOString().slice(0, 10);
/** "2026-11-16 19:30", the home's clock in the form the helper's snapshot uses. */
const local = (t: number) => {
  const d = Math.floor(t / DAY);
  const m = Math.floor(t - d * DAY);
  return `${ymd(d)} ${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

const ageKey = (age: number | null) => (age == null ? "none" : `d${String(age).padStart(3, "0")}`);
const childOf = (age: number | null, over: Partial<Child> = {}): Child => ({ birthDate: age == null ? null : ymd(-age), name: "Lana", sex: "Girl", ...over });
const clockAt = (t: number): Clock => ({ now: DAY0 + t * MIN, today: TODAY, tz: TZ });

test("the fixed clock is 17 November 2026 in Dubai, and the birth dates give the ages", () => {
  const stamp = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms).replace(",", "");
  assert.equal(stamp(DAY0), "2026-11-17 00:00");
  assert.equal(stamp(clockAt(HOURS["2130"]).now), "2026-11-17 21:30");
  assert.equal(iso(at(-1, "19:30")), "2026-11-16T15:30:00.000Z");
  assert.equal(iso(ago(61)), "2026-11-17T07:59:00.000Z");
  assert.equal(local(at(-1, "19:30")), "2026-11-16 19:30");
  assert.equal(childOf(0).birthDate, "2026-11-17");
  assert.equal(childOf(165).birthDate, "2026-06-05");
  assert.equal(childOf(365).birthDate, "2025-11-17");
  assert.equal(childOf(null).birthDate, null);
});

// ---- the logs ---------------------------------------------------------------------------------

type Kind = "feed" | "sleep" | "diaper" | "meal" | "pump" | "wake" | "note";
const LABEL: Record<Kind, string> = { feed: "Feed", sleep: "Sleep", diaper: "Diaper", meal: "Meal", pump: "Pump", wake: "Night wake", note: "Note" };
/** One thing in a log, in minutes from DAY0. `end` is null for what has no end (or a timer never stopped). */
interface Draft {
  kind: Kind;
  start: number;
  end: number | null;
  payload: Record<string, unknown>;
  note: string | null;
}
type Made = Draft & { id: string };

const breast = (start: number, min: number | null, side: "Left" | "Right" | "Both", more: Record<string, unknown> = {}): Draft => ({ kind: "feed", start, end: min == null ? null : start + min, payload: { method: "Breast", side, ...(min == null ? {} : { duration_min: min }), ...more }, note: null });
const bottle = (start: number, ml: number | string, milk = "Morning pumped", more: Record<string, unknown> = {}): Draft => ({ kind: "feed", start, end: null, payload: { method: "Bottle", amount_ml: ml, milk, ...more }, note: null });
const sleep = (start: number, end: number | null, place = "Cot", more: Record<string, unknown> = {}): Draft => ({ kind: "sleep", start, end, payload: { place, ...more }, note: null });
const diaper = (start: number, kind: "Wet" | "Dirty" | "Both"): Draft => ({ kind: "diaper", start, end: null, payload: { kind }, note: null });
const meal = (start: number, food: string): Draft => ({ kind: "meal", start, end: null, payload: { food, amount: "A few spoons", new_food: "No", allergen: "None", reaction: "None" }, note: null });
const pump = (start: number, ml: number): Draft => ({ kind: "pump", start, end: null, payload: { amount_ml: ml, side: "Both" }, note: null });
/** A night wake-up: a timer of its own, from waking to settled again. */
const wake = (start: number, end: number | null, more: Record<string, unknown> = {}): Draft => ({ kind: "wake", start, end, payload: { ...more }, note: null });
const note = (start: number, text: string, more: Record<string, unknown> = {}): Draft => ({ kind: "note", start, end: null, payload: { ...more }, note: text });
/** A timer that ran for so many seconds (a tap by mistake). */
const seconds = (d: Draft, sec: number): Draft => ({ ...d, end: d.start + sec / 60 });

/** Oldest first, each with an id that says what and when ("sleep:11-16T19:30"). */
function made(drafts: Draft[]): Made[] {
  const seen = new Set<string>();
  return [...drafts]
    .sort((a, b) => a.start - b.start || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
    .map((d) => {
      let id = `${d.kind}:${local(d.start).slice(5).replace(" ", "T")}`;
      while (seen.has(id)) id += "b";
      seen.add(id);
      return { ...d, id };
    });
}

/** One entry as the database lists it. Read at `now`, a timer that ends later is still running; with no `now` it is as written. */
function rowOf(d: Made, now: number | null): EntryRow {
  const running = now != null && d.end != null && d.end > now;
  const { duration_min, ...rest } = d.payload;
  return { id: d.id, type_id: `lana.${d.kind}`, type_label: LABEL[d.kind], icon: null, occurred_at: iso(d.start), ended_at: d.end == null || running ? null : iso(d.end), payload: running || duration_min === undefined ? rest : d.payload, note: d.note };
}

/**
 * The log as the app has it at `now`, newest first as the database lists it: the last 7 x 24
 * hours for Home, the last 14 days for the child's page and the helper, 36 hours for the nap
 * push.
 */
function entriesAt(log: Made[], now: number, days = 7): EntryRow[] {
  return log
    .filter((d) => d.start <= now && d.start >= now - days * DAY)
    .reverse()
    .map((d) => rowOf(d, now));
}

/** A hand-written log read at 13:00, as Home has it. */
const readAtOne = (drafts: Draft[]) => entriesAt(made(drafts), ONE);

/** What a usual day holds at an age, from the app's own tables. */
interface Plan {
  feeds: number;
  nightFeeds: number;
  wet: number;
  dirty: number;
  naps: number;
  awake: number;
  napLen: number;
  /** Bedtime, minutes after midnight. */
  bed: number;
  meals: number;
  bottleMl: number;
}

const WAKE = 6 * 60 + 30;
const round5 = (x: number) => Math.round(x / 5) * 5;
const mid = (lo: number, hi: number) => Math.round((lo + hi) / 2);

/**
 * A usual day for an age in days: the middle of the app's usual feeds, wet and dirty diapers
 * (lib/norms) and of its usual naps and awake window (lib/stage). The nap length fills the
 * day from 06:30 towards a bedtime near 19:30; young babies feed two or three times a night.
 */
function planFor(age: number): Plan {
  const stage = calls.stageOf({ ageDays: age });
  const norms = calls.normsForAge({ child: childOf(age), clock: clockAt(ONE) })!;
  const naps = mid(stage.naps[0], stage.naps[1]);
  const awake = round5((stage.awake[0] + stage.awake[1]) / 2);
  const napLen = Math.min(120, Math.max(30, Math.floor((13 * 60 - (naps + 1) * awake) / naps / 5) * 5));
  return {
    feeds: mid(norms.feeds.low, norms.feeds.high),
    nightFeeds: age < 31 ? 3 : age < 92 ? 2 : 1,
    wet: mid(norms.wet.low, norms.wet.high),
    dirty: Math.max(1, mid(norms.dirty.low, norms.dirty.high)),
    naps,
    awake,
    napLen,
    bed: WAKE + (naps + 1) * awake + naps * napLen,
    meals: stage.meals ? mid(stage.meals[0], stage.meals[1]) : 0,
    bottleMl: age < 31 ? 60 : age < 92 ? 90 : age < 183 ? 120 : age < 274 ? 150 : 180,
  };
}

const FOODS = ["Oat porridge", "Mashed banana", "Carrot puree", "Yoghurt", "Avocado", "Sweet potato", "Pear puree"];
const NOTES = ["Seemed happy after the walk", "A bit fussy before the nap", "Laughed at the cat"];

/** From 06:30 to bedtime on one day: naps, feeds, diapers, meals, two pumps and now and then a note, all while awake. */
function dayPart(p: Plan, day: number, extraFeeds = 0): Draft[] {
  const base = day * DAY;
  const out: Draft[] = [];
  const naps: [number, number][] = [];
  let t = base + WAKE;
  for (let i = 0; i < p.naps; i++) {
    t += p.awake;
    naps.push([t, t + p.napLen]);
    out.push(sleep(t, t + p.napLen, i % 2 ? "Pram" : "Cot"));
    t += p.napLen;
  }
  const bed = base + p.bed;
  // A time that falls in a nap, or in the 20 minutes before one, moves to just after it.
  const awake = (x: number, after: number) => {
    const nap = naps.find(([a, b]) => x > a - 20 && x < b + after);
    return nap ? nap[1] + after : x;
  };
  // `count` times spread evenly from `from` to `to`, each awake and at least `gap` after the one before.
  const spread = (count: number, from: number, to: number, after: number, gap: number) => {
    const times: number[] = [];
    for (let j = 0; j < count; j++) {
      let x = awake(count === 1 ? from : round5(from + (j * (to - from)) / (count - 1)), after);
      if (times.length && x < times[times.length - 1] + gap) x = awake(times[times.length - 1] + gap, after);
      times.push(x);
    }
    return times;
  };
  spread(p.feeds - p.nightFeeds + extraFeeds, base + WAKE + 5, bed - 25, 5, 20).forEach((x, j) => {
    out.push(j % 2 ? bottle(x, p.bottleMl, j % 4 === 1 ? "Morning pumped" : "Formula") : breast(x, 15, (j / 2 + day) % 2 ? "Right" : "Left"));
  });
  const both = Math.floor(p.dirty / 2);
  const kinds: ("Wet" | "Dirty" | "Both")[] = Array.from({ length: p.wet + p.dirty - both }, () => "Wet");
  for (let j = 0; j < p.dirty; j++) kinds[Math.floor(((j + 0.5) * kinds.length) / p.dirty)] = j < both ? "Both" : "Dirty";
  spread(kinds.length, base + WAKE + 10, bed - 10, 10, 15).forEach((x, j) => out.push(diaper(x, kinds[j])));
  const slots = p.meals === 1 ? ["12:15"] : p.meals === 2 ? ["08:00", "17:30"] : p.meals >= 3 ? ["08:00", "12:15", "17:30"] : [];
  slots.forEach((s, j) => out.push(meal(awake(at(day, s), 15), FOODS[(((day + j) % FOODS.length) + FOODS.length) % FOODS.length])));
  out.push(pump(base + WAKE + 25, 110), pump(awake(bed - 45, 20), 90));
  if (day % 2 === 0) out.push(note(awake(at(day, "10:00"), 10), NOTES[Math.abs(day / 2) % NOTES.length]));
  return out;
}

/** From bedtime on `day` to 06:30 the next morning: stretches of sleep with a breastfeed between them. */
function nightPart(p: Plan, day: number): Draft[] {
  const to = (day + 1) * DAY + WAKE;
  const stretch = Math.floor((to - (day * DAY + p.bed) - p.nightFeeds * 20) / (p.nightFeeds + 1));
  const out: Draft[] = [];
  let t = day * DAY + p.bed;
  for (let i = 0; i <= p.nightFeeds; i++) {
    const end = i === p.nightFeeds ? to : t + stretch;
    out.push(sleep(t, end));
    if (i < p.nightFeeds) out.push(breast(end, 15, i % 2 ? "Left" : "Right"));
    t = end + 20;
  }
  return out;
}

/** A full normal week: nine usual days and nights up to today. */
function normalLog(p: Plan): Draft[] {
  const out: Draft[] = [];
  for (let day = -8; day <= 0; day++) out.push(...dayPart(p, day), ...nightPart(p, day));
  return out;
}

/**
 * A family that logs little. On every day but one: a morning bottle and one wet diaper. On
 * four days a morning nap; on three an afternoon diaper, 5 hours after the morning one; on
 * three an evening bottle. One night's sleep in the whole week, six days ago.
 * - At 07:30 the week holds five finished sleeps, one short of what the sleep rhythm needs.
 * - Yesterday has a late second nap, 5 h 20 min after the first, that ends at 17:30: at
 *   07:30 the child has been "awake" for 14 hours, and the last feed is yesterday's.
 * - Today: nothing before 08:10, three wet diapers by 13:00, and a second nap 3 h 50 min
 *   after the first.
 */
function sparseLog(p: Plan): Draft[] {
  const out: Draft[] = [];
  for (const day of [-8, -7, -6, -5, -4, -2, -1, 0]) {
    out.push(bottle(at(day, "08:10"), p.bottleMl), diaper(at(day, "09:00"), "Wet"));
    if (day === -6 || day >= -2) out.push(sleep(at(day, "09:40"), at(day, "10:40")));
    if (day === -6 || day === -5 || day === -2) out.push(diaper(at(day, "14:00"), "Wet"));
    if (day === -6 || day === -2 || day === -1) out.push(bottle(at(day, "18:20"), p.bottleMl, "Formula"));
  }
  out.push(note(at(-6, "11:00"), "Back from the trip"), sleep(at(-6, "19:30"), at(-5, "05:00")), diaper(at(-4, "17:00"), "Both"), sleep(at(-1, "16:00"), at(-1, "17:30"), "Pram"));
  out.push(diaper(at(0, "11:30"), "Wet"), diaper(at(0, "12:30"), "Wet"), sleep(at(0, "14:30"), at(0, "16:00"), "Pram"));
  if (p.meals) out.push(meal(at(-1, "12:00"), "Mashed banana"));
  return out;
}

/**
 * The bad day. Usual days first, with no dirty diaper after 07:00 five days ago, a sleep of
 * 10 h 30 min in one go five nights ago, a 250 ml bottle four days ago and a cluster of
 * extra feeds on the last two full days. Last night has a note logged during the sleep and
 * ends at 02:00. Today: nothing until a 250 ml bottle at 07:40 and one wet diaper at 07:45,
 * a 20 minute nap at 12:25 and a 30 ml bottle at 20:00. So by the hour: a long awake stretch
 * and a long gap between feeds at 07:30, a short nap at 13:00, few feeds, few wet diapers
 * and little sleep at 21:30, and no dirty diaper for 5 days all day. The sleep and the two
 * bottles sit between what is questioned for a baby (over 10 h, over 240 ml) and what a
 * later rule may allow an older child (13 h, 350 ml).
 */
function badLog(p: Plan): Draft[] {
  const usual: Draft[] = [];
  for (const day of [-8, -7, -6, -5, -3, -2, -1]) usual.push(...dayPart(p, day, day >= -2 ? 3 : 0));
  for (const day of [-8, -7, -6, -4, -3, -2]) usual.push(...nightPart(p, day));
  const lastDirty = at(-5, "07:00");
  const out = usual
    .filter((d) => !(d.kind === "diaper" && d.start > lastDirty && d.payload.kind === "Dirty"))
    .map((d) => (d.kind === "diaper" && d.start > lastDirty && d.payload.kind === "Both" ? diaper(d.start, "Wet") : d));
  out.push(diaper(lastDirty, "Dirty"));
  // Five nights ago: 10 h 30 min in one go from bedtime, nothing logged during it. The day after starts late.
  out.push(sleep(-5 * DAY + p.bed, -5 * DAY + p.bed + 630));
  out.push(
    diaper(at(-4, "09:30"), "Wet"),
    breast(at(-4, "09:35"), 15, "Left"),
    sleep(at(-4, "11:30"), at(-4, "12:30")),
    bottle(at(-4, "12:40"), p.bottleMl),
    diaper(at(-4, "13:00"), "Wet"),
    bottle(at(-4, "15:00"), p.bottleMl, "Formula"),
    sleep(at(-4, "15:30"), at(-4, "16:15"), "Pram"),
    bottle(at(-4, "17:10"), 250),
    diaper(at(-4, "18:10"), "Wet"),
  );
  out.push(sleep(-DAY + p.bed, at(0, "02:00")), note(at(-1, "23:15"), "Coughing a little in her sleep"));
  out.push(bottle(at(0, "07:40"), 250), diaper(at(0, "07:45"), "Wet"), sleep(at(0, "12:25"), at(0, "12:45")), bottle(at(0, "20:00"), 30, "Formula"));
  return out;
}

/**
 * A log of mis-entries and odd sleeps. Most days hold a morning bottle, a wet diaper and
 * one nap.
 * - Seven days ago: a sleep its limit stopped after a day.
 * - Six days ago: a sleep that starts at 06:15, an afternoon sleep of 4 h 10 min and a
 *   night of 9 h 50 min (none of them counts as a nap).
 * - Five, three and two days ago: a long second nap soon after the first (100, 60 and 30
 *   minutes after it; 110, 105 and 100 minutes long), so the longest naps follow short
 *   awake stretches.
 * - Four days ago: a sleep of 20 seconds, a breastfeed of 70 minutes, two diapers a minute
 *   apart, a feed its limit stopped, a long feed confirmed as real, a feed with a diaper
 *   logged during it, a feed timer never stopped, a 250 ml bottle and a 10 h 30 min sleep
 *   with a night wake-up logged during it (which is no sign of a timer left on).
 * - Three days ago: a feed of 30 seconds, two bottles a minute apart, two notes a minute
 *   apart, and an afternoon sleep with a diaper and a bottle logged during it.
 * - The night before last: a night wake-up its limit stopped, one of 10 seconds, and one
 *   started at 03:00 and never ended.
 * - Yesterday at 16:30 a sleep timer was started and never stopped.
 * - Today at 08:30 a feed timer was started and never stopped, with nothing logged after it.
 */
function mistakesLog(p: Plan): Draft[] {
  const out: Draft[] = [];
  for (const day of [-8, -7, -6, -5, -3, -2, -1]) out.push(bottle(at(day, "08:10"), p.bottleMl), diaper(at(day, "09:00"), "Wet"), sleep(at(day, "09:40"), at(day, "10:40")));
  out.push(sleep(at(-7, "19:00"), at(-6, "19:00"), "Cot", { auto_end: true }));
  out.push(sleep(at(-6, "06:15"), at(-6, "06:55")), sleep(at(-6, "12:00"), at(-6, "16:10")), sleep(at(-6, "19:40"), at(-5, "05:30")));
  out.push(sleep(at(-5, "12:20"), at(-5, "14:10"), "Pram"), sleep(at(-3, "11:40"), at(-3, "13:25"), "Pram"), sleep(at(-2, "11:10"), at(-2, "12:50"), "Pram"));
  out.push(
    diaper(at(-4, "06:40"), "Wet"),
    breast(at(-4, "06:45"), 15, "Left"),
    seconds(sleep(at(-4, "08:00"), null), 20),
    breast(at(-4, "08:30"), 70, "Left"),
    diaper(at(-4, "09:50"), "Wet"),
    diaper(at(-4, "09:51"), "Wet"),
    breast(at(-4, "10:00"), 60, "Right", { auto_end: true }),
    sleep(at(-4, "11:15"), at(-4, "12:30")),
    breast(at(-4, "12:40"), 50, "Left", { timer_ok: true }),
    diaper(at(-4, "13:45"), "Wet"),
    breast(at(-4, "14:00"), 70, "Right"),
    diaper(at(-4, "14:30"), "Wet"),
    breast(at(-4, "15:20"), null, "Left"),
    sleep(at(-4, "16:00"), at(-4, "17:00"), "Pram"),
    bottle(at(-4, "17:10"), 250),
    bottle(at(-4, "18:10"), 150, "Formula"),
    diaper(at(-4, "18:15"), "Wet"),
    sleep(at(-4, "18:30"), at(-3, "05:00")),
    wake(at(-4, "23:30"), at(-4, "23:50")),
  );
  out.push(
    seconds(breast(at(-3, "07:00"), null, "Right"), 30),
    bottle(at(-3, "15:00"), p.bottleMl, "Formula"),
    bottle(at(-3, "15:01"), p.bottleMl, "Formula"),
    note(at(-3, "17:00"), "Rash on the left cheek"),
    note(at(-3, "17:01"), "Rash on the left cheek"),
    sleep(at(-3, "14:00"), at(-3, "16:00")),
    diaper(at(-3, "14:40"), "Wet"),
  );
  out.push(wake(at(-2, "01:00"), at(-2, "02:00"), { auto_end: true }), seconds(wake(at(-2, "02:30"), null), 10), wake(at(-2, "03:00"), null));
  out.push(sleep(at(-1, "16:30"), null), bottle(at(-1, "18:00"), p.bottleMl, "Formula"), bottle(at(0, "08:00"), p.bottleMl), breast(at(0, "08:30"), null, "Right"));
  return out;
}

function logsFor(age: number | null): Record<string, Made[]> {
  // With no birth date the app assumes 120 days, so that child's usual day is a 120-day-old's.
  const p = planFor(age ?? 120);
  const logs: Record<string, Made[]> = { normal: made(normalLog(p)), sparse: made(sparseLog(p)), empty: [], bad: made(badLog(p)) };
  if (SOME_AGES.includes(age)) logs.mistakes = made(mistakesLog(p));
  return logs;
}

// ---- plain inputs worked out from a log (what the database hands the app) ---------------------

/** One day's totals as the daily stats give them. Sleep is counted up to `now`. */
function totalsOf(log: Made[], day: number, now: number) {
  const from = day * DAY;
  const to = from + DAY;
  const inDay = log.filter((e) => e.start >= from && e.start < to && e.start <= now);
  const feeds = inDay.filter((e) => e.kind === "feed");
  const diapers = inDay.filter((e) => e.kind === "diaper");
  const bottles = feeds.filter((e) => e.payload.method === "Bottle");
  const slept = (a: number, b: number) => Math.round(log.filter((e) => e.kind === "sleep" && e.start <= now).reduce((s, e) => s + Math.max(0, Math.min(e.end ?? now, now, b) - Math.max(e.start, a)), 0));
  return {
    breast_count: feeds.filter((e) => e.payload.method === "Breast").length,
    bottle_count: bottles.length,
    bottle_ml: bottles.reduce((s, e) => s + Number(e.payload.amount_ml), 0),
    diapers_wet: diapers.filter((e) => e.payload.kind !== "Dirty").length,
    diapers_dirty: diapers.filter((e) => e.payload.kind !== "Wet").length,
    sleep_min: slept(from, to),
    // The night that starts that evening: 19:00 to 07:00.
    night_sleep_min: slept(from + 19 * 60, to + 7 * 60),
  };
}
type Totals = ReturnType<typeof totalsOf>;
const TOTAL_KEYS = ["breast_count", "bottle_count", "bottle_ml", "diapers_wet", "diapers_dirty", "sleep_min", "night_sleep_min"] as const;

/** The average day over the last 7 full days, as Week and Trends work it out. */
function weekMean(log: Made[]): Totals {
  const days = [-7, -6, -5, -4, -3, -2, -1].map((d) => totalsOf(log, d, Infinity));
  return Object.fromEntries(TOTAL_KEYS.map((k) => [k, days.reduce((s, d) => s + d[k], 0) / days.length])) as Totals;
}

/** A short print of a generated log, so a changed generator shows up as itself and not as a changed rule. */
function printOf(entries: EntryRow[]) {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(entries)) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
  const count = (kind: Kind) => entries.filter((e) => e.type_id === `lana.${kind}`).length;
  return { entries: entries.length, feed: count("feed"), sleep: count("sleep"), diaper: count("diaper"), meal: count("meal"), pump: count("pump"), wake: count("wake"), note: count("note"), print: h.toString(16).padStart(8, "0") };
}

// ---- the home the helper reads ------------------------------------------------------------------

const ALL = { view: true, add: true, edit: true, delete: true };
/** A parent, an admin: sees every part of the app. */
const PARENT: Me = {
  ok: true,
  member: { id: "11111111-aaaa-4aaa-8aaa-000000000001", user_id: null, email: null, display_name: "Sam", role_id: "admin", birth_date: null, relationship: "Father", is_active: true, breastfeeds: false, lang: "en", simple_mode: false },
  role: { id: "admin", label: "Admin", description: null, sort: 1 },
  permissions: { members: ALL, lana: ALL, calendar: ALL, calendar_family: ALL, photos: ALL, assistant: ALL, audit: ALL },
  presence: null,
  work_days: [1, 2, 3, 4, 5],
  household: { id: "22222222-bbbb-4bbb-8bbb-000000000001", name: "The test home", timezone: TZ, currency: "AED", notes: null, milk_target_ml: 300, hidden_modules: [] },
};
/** A grandmother who helps: the child's log and the members, nothing else; Arabic, the simple screen. */
const CARER: Me = {
  ...PARENT,
  member: { ...PARENT.member, id: "11111111-aaaa-4aaa-8aaa-000000000002", display_name: "Noor", role_id: "family_carer", relationship: "Sam's mother", lang: "ar", simple_mode: true },
  role: { id: "family_carer", label: "Family carer", description: null, sort: 2 },
  permissions: { members: { view: true }, lana: { view: true, add: true }, assistant: { view: true, add: true } },
  household: { ...PARENT.household, notes: "The lift is slow: allow ten minutes to get out of the door.", hidden_modules: ["photos"] },
};

const TYPE_ROWS = (["feed", "sleep", "diaper", "meal", "pump", "wake", "note"] as Kind[]).map((key, i) => ({ id: `lana.${key}`, module_id: "lana", key, label: LABEL[key], icon: null, color: null, sort: i + 1, has_end: key === "feed" || key === "sleep" || key === "wake", due_after_min: key === "feed" ? TYPE_GAP_MIN : null, fields: [], show_on_home: true, is_active: true, settings: {} }));
const MEMBER_ROWS = [
  { id: CARER.member.id, display_name: "Noor", routine: null, role_id: "family_carer", relationship: "Sam's mother" },
  { id: PARENT.member.id, display_name: "Sam", routine: "Works 9 to 5 on week days, out by 08:30.", role_id: "admin", relationship: "Father" },
];
const ROLE_ROWS = [{ id: "admin", label: "Admin" }, { id: "family_carer", label: "Family carer" }];
const SKILL_ROWS = [
  { id: "coach", title: "How to coach", when: "Always.", triggers: [], body: "Answer first. One step at a time. A red flag goes to the doctor.", sources: "house rules", always_on: true, age_from_days: null, age_to_days: null, sort: 1, is_active: true },
  { id: "sleep", title: "Sleep", when: "Naps, bedtime and night waking.", triggers: ["nap", "sleep"], body: "Watch the awake window before the clock.", sources: "NHS", always_on: false, age_from_days: null, age_to_days: null, sort: 2, is_active: true },
  { id: "solids", title: "Starting solids", when: "First foods, from about 6 months.", triggers: ["solids", "puree"], body: "One new food at a time.", sources: "NHS", always_on: false, age_from_days: 150, age_to_days: 400, sort: 3, is_active: true },
];
const SUBJECT_ID = "33333333-cccc-4ccc-8ccc-000000000001";
/** The summary of a home where nothing has been logged. */
const NOTHING_LOGGED = { ok: true, ongoing: [], last: {}, today_counts: {}, custody: null };

/** One home around a child: the member asking, the rows the helper lists, and what the database functions answer. */
function homeOf(child: Child, over: { me?: Me; answers?: Record<string, unknown>; entries?: EntryRow[]; routine?: boolean } = {}): Home {
  return {
    me: over.me ?? PARENT,
    tables: {
      care_subjects: [{ id: SUBJECT_ID, name: child.name ?? "Lana", module_id: "lana", kind: "child", birth_date: child.birthDate, profile: { ...(child.sex == null ? {} : { sex: child.sex }), emergency_ambulance: "998" } }],
      care_entry_types: TYPE_ROWS,
      // A parent's written routine ("works 9 to 5") is known to the helper only where asked for.
      members: over.routine ? MEMBER_ROWS : MEMBER_ROWS.map((m) => ({ ...m, routine: null })),
      roles: ROLE_ROWS,
    },
    answers: { memory_list: { ok: true, items: [] }, skill_list: { ok: true, items: SKILL_ROWS }, ask_chat_recaps: { ok: true, items: [] }, home_summary: NOTHING_LOGGED, ...over.answers },
    entries: over.entries ?? [],
  };
}

/**
 * What the database functions answer for a log read at `now`: the summary Home reads
 * (the last entry of each kind, what is running, today's counts, who has the child), the
 * daily stats of the last 7 days and today, the coach plan, the milk and who is home. Worked
 * out here by plain arithmetic, the way those functions do; `next_due` is the last feed's
 * end plus the gap for the age (3 hours under 6 months, 4 after).
 */
function answersOf(log: Made[], age: number | null, now: number, hour: string, logName: string): Record<string, unknown> {
  const seen = log.filter((e) => e.start <= now);
  const newest = (kind: Kind) => {
    const e = [...seen].reverse().find((x) => x.kind === kind);
    return e ? rowOf(e, now) : null;
  };
  const feed = newest("feed");
  const feedGap = (age ?? 120) / 30.4375 < 6 ? 180 : 240;
  const last: Record<string, unknown> = {};
  for (const kind of ["sleep", "diaper", "meal", "pump"] as Kind[]) {
    const e = newest(kind);
    if (e) last[`lana.${kind}`] = { occurred_at: e.occurred_at, ended_at: e.ended_at, payload: e.payload };
  }
  if (feed) last["lana.feed"] = { occurred_at: feed.occurred_at, ended_at: feed.ended_at, payload: feed.payload, next_due: new Date(Date.parse(feed.ended_at ?? feed.occurred_at) + feedGap * MIN).toISOString() };
  const today_counts: Record<string, number> = {};
  for (const e of seen) if (e.start >= 0) today_counts[`lana.${e.kind}`] = (today_counts[`lana.${e.kind}`] ?? 0) + 1;
  const ongoing = [...seen].reverse().filter((e) => e.kind === "sleep" && (e.end == null || e.end > now) && now - e.start <= DAY).map((e) => ({ type_id: "lana.sleep", occurred_at: iso(e.start) }));
  // One row a day, each with the night that starts that evening (19:00 to 07:00).
  const days = [-7, -6, -5, -4, -3, -2, -1, 0].map((day) => {
    const from = at(day, "19:00");
    const to = at(day + 1, "07:00");
    const stretches = seen.filter((e) => e.kind === "sleep").map((e) => Math.round(Math.min(e.end ?? now, now, to) - Math.max(e.start, from))).filter((m) => m > 0);
    return { day: ymd(day), ...totalsOf(log, day, now), night_wakes: Math.max(0, stretches.length - 1), night_feeds: seen.filter((e) => e.kind === "feed" && e.start >= from && e.start < to).length, longest_stretch_min: Math.max(0, ...stretches) };
  });
  return {
    home_summary: { ok: true, ongoing, last, today_counts, custody: hour === "1300" ? { name: "Noor" } : null },
    care_daily_stats: { ok: true, night_from: "19:00", night_to: "07:00", days },
    coach_plan_active: { ok: true, plan: logName === "normal" ? { goal: "Earlier bedtime", day: 3, days: 7, today_step: "Start the wind-down at 18:30", done_today: hour === "2130" } : null },
    coach_plan_history: { ok: true, plans: logName === "sparse" ? [{ goal: "Longer first nap", status: "done", done: 5, days: 7, to: "2026-11-10", notes: ["Went well from day three", "Pram naps did not count"] }] : [] },
    milk_list: hour === "0730" ? { ok: false, error: "forbidden" } : hour === "2130" ? { ok: true, fridge_ml: 0, fridge_count: 0, freezer_ml: 0, freezer_count: 0 } : { ok: true, fridge_ml: 270, fridge_count: 2, freezer_ml: 180, freezer_count: 1 },
    household_today:
      hour === "0730"
        ? null
        : { ok: true, members: [{ name: "Sam", presence: { in_house: hour === "2130", label: "At work", ends_on: null }, works_today: true }, { name: "Noor", presence: hour === "2130" ? null : { in_house: true, label: "Staying", ends_on: "2026-11-20" }, works_today: false }] },
  };
}

// ---- the hand-written cases: each rule just under and just over its line -------------------------

/**
 * What main expects at four ages, written out: one age in each row of the usual ranges. The
 * hand-written logs are built from these numbers and not from the app's tables, so a changed
 * table cannot move a log along with its rule.
 */
const EDGE: Record<number, { wetLow: number; feedsLow: number; sleepLowMin: number; awake: [number, number]; gap: number; late: [number, number] }> = {
  20: { wetLow: 6, feedsLow: 8, sleepLowMin: 840, awake: [45, 60], gap: 180, late: [240, 300] },
  60: { wetLow: 6, feedsLow: 7, sleepLowMin: 840, awake: [60, 90], gap: 180, late: [240, 300] },
  150: { wetLow: 6, feedsLow: 6, sleepLowMin: 720, awake: [105, 150], gap: 180, late: [240, 300] },
  300: { wetLow: 5, feedsLow: 4, sleepLowMin: 720, awake: [150, 210], gap: 240, late: [300, 360] },
};
const EDGE_AGES = [20, 60, 150, 300];

/** One quiet day read at 13:00, with every count on its line. All times are minutes before 13:00. */
interface Quiet {
  /** The oldest entry of the log, a note. */
  span: number;
  /** Wet diapers, the newest `lastDiaperAgo` ago. */
  wet: number;
  lastDiaperAgo: number;
  /** The one dirty diaper; null for none. */
  dirtyAgo: number | null;
  /** Bottles of 120 ml, the newest `lastFeedAgo` ago and of `lastFeedMl`. */
  feeds: number;
  lastFeedAgo: number;
  lastFeedMl: number;
  /** Sleep in all: one long block and then the last sleep, of `napMin`. */
  sleepMin: number;
  napMin: number;
  /** Awake since the last sleep ended; null for still asleep. */
  awakeMin: number | null;
  extra: Draft[];
}

/**
 * A day on which the guide has nothing to say at that age, changed in one thing: the log
 * starts 20 hours ago, the usual lowest number of wet diapers and of feeds, a diaper and a
 * feed an hour ago, the usual lowest sleep, and awake for a little less than the usual window.
 */
function quiet(age: number, change: Partial<Quiet> = {}): Draft[] {
  const e = EDGE[age];
  const q: Quiet = { span: 1200, wet: e.wetLow, lastDiaperAgo: 60, dirtyAgo: 600, feeds: e.feedsLow, lastFeedAgo: 60, lastFeedMl: 120, sleepMin: e.sleepLowMin, napMin: 60, awakeMin: e.awake[0] - 5, extra: [], ...change };
  // `count` times: the newest, then the others evenly from 40 minutes before it back to `oldest`.
  const spread = (count: number, newest: number, oldest: number) => Array.from({ length: count }, (_, i) => (i === 0 ? newest : Math.round(newest + 40 + ((i - 1) * (oldest - newest - 40)) / Math.max(1, count - 2))));
  const out: Draft[] = [note(ago(q.span), "First thing written down"), ...q.extra];
  for (const m of spread(q.wet, q.lastDiaperAgo, q.span - 20)) out.push(diaper(ago(m), "Wet"));
  if (q.dirtyAgo != null) out.push(diaper(ago(q.dirtyAgo), "Dirty"));
  spread(q.feeds, q.lastFeedAgo, q.span - 10).forEach((m, i) => out.push(bottle(ago(m), i === 0 ? q.lastFeedMl : 120)));
  const napFrom = (q.awakeMin ?? 0) + q.napMin;
  out.push(q.awakeMin == null ? sleep(ago(napFrom), null) : sleep(ago(napFrom), ago(q.awakeMin)));
  if (q.sleepMin > q.napMin) out.push(sleep(ago(napFrom + 120 + q.sleepMin - q.napMin), ago(napFrom + 120)));
  return out;
}

/** The guide's lines, each from both sides, at one age. */
function tipEdges(age: number): [string, Draft[]][] {
  const e = EDGE[age];
  const [lo, hi] = e.awake;
  const Q = (name: string, change: Partial<Quiet> = {}): [string, Draft[]] => [name, quiet(age, change)];
  // How long ago a last bottle of `ml` (of the usual 120) puts the next feed about 15 minutes ahead.
  const soonAfter = (ml: number) => Math.floor(e.gap * (0.5 + (0.5 * ml) / 120)) - 15;
  return [
    Q("a quiet day"),
    // Totals are judged once the log covers 18 hours.
    Q("the log starts 18 h 00 min ago, one wet diaper", { span: 1080, wet: 1 }),
    Q("the log starts 17 h 59 min ago, one wet diaper", { span: 1079, wet: 1 }),
    Q("a wet diaper 24 h 00 min ago is counted", { wet: e.wetLow - 1, extra: [diaper(ago(1440), "Wet")] }),
    Q("a wet diaper 24 h 01 min ago is not", { wet: e.wetLow - 1, extra: [diaper(ago(1441), "Wet")] }),
    Q("wet diapers: one under the usual", { wet: e.wetLow - 1 }),
    Q("wet diapers: two under", { wet: e.wetLow - 2 }),
    Q("wet diapers: three under", { wet: e.wetLow - 3 }),
    Q("wet diapers: none", { wet: 0 }),
    Q("the last diaper 5 h 00 min ago", { lastDiaperAgo: 300 }),
    Q("the last diaper 5 h 01 min ago", { lastDiaperAgo: 301 }),
    Q("the last dirty diaper 4 days ago to the minute", { dirtyAgo: 5760 }),
    Q("the last dirty diaper 4 days and 1 min ago", { dirtyAgo: 5761 }),
    Q("feeds: one under the usual", { feeds: e.feedsLow - 1 }),
    Q("feeds: two under", { feeds: e.feedsLow - 2 }),
    Q("feeds: three under", { feeds: e.feedsLow - 3 }),
    Q("the last feed on the yellow line", { lastFeedAgo: e.late[0] }),
    Q("the last feed 1 min past the yellow line", { lastFeedAgo: e.late[0] + 1 }),
    Q("the last feed on the red line", { lastFeedAgo: e.late[1] }),
    Q("the last feed 1 min past the red line", { lastFeedAgo: e.late[1] + 1 }),
    Q("the next feed in 31 min", { lastFeedAgo: e.gap - 31 }),
    Q("the next feed in 30 min", { lastFeedAgo: e.gap - 30 }),
    Q("the next feed in 1 min", { lastFeedAgo: e.gap - 1 }),
    Q("the next feed due now", { lastFeedAgo: e.gap }),
    Q("the next feed due 59 min ago", { lastFeedAgo: e.gap + 59 }),
    Q("a last bottle of 89 ml, a small one", { lastFeedAgo: soonAfter(89), lastFeedMl: 89 }),
    Q("a last bottle of 90 ml, not a small one", { lastFeedAgo: soonAfter(90), lastFeedMl: 90 }),
    // The awake stretch and the last nap.
    Q("awake 12 h 00 min since the last sleep", { awakeMin: 720 }),
    Q("awake 12 h 01 min since the last sleep", { awakeMin: 721 }),
    Q("a nap of 29 min, awake 59 min", { napMin: 29, awakeMin: 59 }),
    Q("a nap of 30 min, awake 59 min", { napMin: 30, awakeMin: 59 }),
    Q("a nap of 29 min, awake 60 min", { napMin: 29, awakeMin: 60 }),
    Q("awake to the start of the usual window", { awakeMin: lo }),
    Q("awake 1 min into the usual window, after a nap of 30 min", { awakeMin: lo + 1, napMin: 30 }),
    Q("awake 1 min into the usual window, after a nap of 29 min", { awakeMin: lo + 1, napMin: 29 }),
    Q("awake to the end of the usual window", { awakeMin: hi }),
    Q("awake 1 min past the usual window", { awakeMin: hi + 1 }),
    Q("awake 45 min past the usual window", { awakeMin: hi + 45 }),
    Q("awake 46 min past the usual window", { awakeMin: hi + 46 }),
    Q("asleep now", { awakeMin: null }),
    // Sleep in 24 hours.
    Q("sleep 1 h 00 min under the usual", { sleepMin: e.sleepLowMin - 60 }),
    Q("sleep 1 h 01 min under the usual", { sleepMin: e.sleepLowMin - 61 }),
    Q("sleep 3 h 00 min under the usual", { sleepMin: e.sleepLowMin - 180 }),
    Q("sleep 3 h 01 min under the usual", { sleepMin: e.sleepLowMin - 181 }),
    Q("a sleep from 25 to 23 hours ago counts for its hour inside the 24", { sleepMin: e.sleepLowMin - 121, extra: [sleep(ago(1500), ago(1380))] }),
  ];
}

/**
 * Bottles on the six days before today (`perDay[0]` is yesterday's count), from 06:00 through
 * the day, and a little of today so the last 24 hours are not empty. The seventh day back
 * has no feed: Home's week cuts it at 13:00.
 */
function feedDays(perDay: number[]): Draft[] {
  const out: Draft[] = [];
  perDay.forEach((count, i) => {
    for (let j = 0; j < count; j++) out.push(bottle(at(-(i + 1), "06:00") + Math.round((j * 840) / count), 120));
  });
  out.push(bottle(at(0, "07:10"), 120), diaper(at(0, "07:20"), "Wet"), sleep(at(0, "09:00"), at(0, "10:00")), bottle(at(0, "10:10"), 120), diaper(at(0, "10:20"), "Dirty"), bottle(at(0, "12:20"), 120));
  return out;
}
/** A growth spurt is feeds up by a quarter over the last 2 full days against the days before, of which 3 must have feeds, 4 a day or more. */
const SPURTS: [string, number[]][] = [
  ["10 a day after 8 a day: up by a quarter exactly", [10, 10, 8, 8, 8, 8]],
  ["10 a day after 8.25 a day: under a quarter", [10, 10, 8, 8, 8, 9]],
  ["5 a day after 4 a day", [5, 5, 4, 4, 4, 4]],
  ["5 a day after 3.75 a day: too few before", [5, 5, 4, 4, 4, 3]],
  ["three earlier days with feeds", [10, 10, 8, 8, 8, 0]],
  ["two earlier days with feeds", [10, 10, 8, 8, 0, 0]],
  ["no feed the day before yesterday", [10, 0, 8, 8, 8, 8]],
  ["9.5 a day after 7.5 a day", [9, 10, 7, 7, 8, 8]],
  ["12 a day after 9.67 a day: just under a quarter", [12, 12, 10, 10, 9, 0]],
];

/**
 * Mis-entries, each from both sides of its line, read at 13:00. A baby's limits: a sleep over
 * 10 hours, a bottle over 240 ml, a breastfeed over 45 minutes, a feed or a night wake-up
 * running over an hour and a sleep over a day, a timer under 45 seconds, the same thing twice
 * within 2 minutes, something logged more than 10 minutes inside a timer.
 */
const CHECK_EDGES: [string, Draft[]][] = [
  ["a sleep of 10 h 00 min", [sleep(at(-1, "19:00"), at(0, "05:00"))]],
  ["a sleep of 10 h 01 min", [sleep(at(-1, "19:00"), at(0, "05:01"))]],
  ["a bottle of 240 ml", [bottle(at(0, "08:00"), 240)]],
  ["a bottle of 241 ml", [bottle(at(0, "08:00"), 241)]],
  ["a bottle whose amount came as the text 300", [bottle(at(0, "08:00"), "300")]],
  ["a breastfeed of 45 min", [breast(at(0, "08:00"), 45, "Left")]],
  ["a breastfeed of 46 min", [breast(at(0, "08:00"), 46, "Left")]],
  ["a feed timer running for 60 min", [breast(ago(60), null, "Left")]],
  ["a feed timer running for 61 min, nothing after it", [breast(ago(61), null, "Left")]],
  ["a feed timer running for 61 min, a diaper one minute in", [breast(ago(61), null, "Left"), diaper(ago(60), "Wet")]],
  ["a feed timer running for 61 min, a diaper two minutes in", [breast(ago(61), null, "Left"), diaper(ago(59), "Wet")]],
  ["a sleep timer running for 24 h 00 min", [sleep(ago(1440), null)]],
  ["a sleep timer running for 24 h 01 min, nothing after it", [sleep(ago(1441), null)]],
  ["a sleep timer running for 24 h 01 min, a bottle after it", [sleep(ago(1441), null), bottle(ago(600), 120)]],
  ["a night wake-up open for 60 min", [wake(ago(60), null)]],
  ["a night wake-up open for 61 min", [wake(ago(61), null)]],
  ["a feed of 44 seconds", [seconds(breast(at(0, "08:00"), null, "Left"), 44)]],
  ["a feed of 45 seconds", [seconds(breast(at(0, "08:00"), null, "Left"), 45)]],
  ["a sleep of 44 seconds", [seconds(sleep(at(0, "08:00"), null), 44)]],
  ["a night wake-up of 30 seconds", [seconds(wake(at(0, "03:00"), null), 30)]],
  ["a sleep the timer's limit stopped", [sleep(at(-2, "09:00"), at(-1, "09:00"), "Cot", { auto_end: true })]],
  ["a night wake-up the timer's limit stopped", [wake(at(0, "02:00"), at(0, "03:00"), { auto_end: true })]],
  ["a sleep with a diaper 10 min in", [sleep(at(0, "09:00"), at(0, "12:00")), diaper(at(0, "09:10"), "Wet")]],
  ["a sleep with a diaper 11 min in", [sleep(at(0, "09:00"), at(0, "12:00")), diaper(at(0, "09:11"), "Wet")]],
  ["a sleep with a diaper 11 min before its end", [sleep(at(0, "09:00"), at(0, "12:00")), diaper(at(0, "11:49"), "Wet")]],
  ["a sleep with a diaper 10 min before its end", [sleep(at(0, "09:00"), at(0, "12:00")), diaper(at(0, "11:50"), "Wet")]],
  ["a sleep with a diaper and a bottle during it", [sleep(at(0, "09:00"), at(0, "12:00")), diaper(at(0, "10:00"), "Wet"), bottle(at(0, "10:30"), 120)]],
  ["a sleep with a night wake-up during it", [sleep(at(-1, "19:00"), at(0, "04:00")), wake(at(-1, "23:00"), at(-1, "23:20"))]],
  ["a sleep with a night wake-up and a diaper during it", [sleep(at(-1, "19:00"), at(0, "04:00")), wake(at(-1, "23:00"), at(-1, "23:20")), diaper(at(-1, "23:05"), "Wet")]],
  ["a sleep with a pump during it", [sleep(at(0, "09:00"), at(0, "12:00")), pump(at(0, "10:00"), 100)]],
  ["a sleep with a meal during it", [sleep(at(0, "09:00"), at(0, "12:00")), meal(at(0, "10:00"), "Pear puree")]],
  ["a sleep with a note during it", [sleep(at(0, "09:00"), at(0, "12:00")), note(at(0, "10:00"), "Stirred, settled again")]],
  ["a breastfeed with a diaper during it", [breast(at(0, "08:00"), 40, "Left"), diaper(at(0, "08:15"), "Wet")]],
  ["two diapers 2 min 00 s apart", [diaper(at(0, "08:00"), "Wet"), diaper(at(0, "08:02"), "Wet")]],
  ["two diapers 2 min 01 s apart", [diaper(at(0, "08:00"), "Wet"), diaper(at(0, "08:02") + 1 / 60, "Wet")]],
  ["two bottles a minute apart", [bottle(at(0, "08:00"), 120), bottle(at(0, "08:01"), 120)]],
  ["two notes a minute apart", [note(at(0, "08:00"), "A new tooth"), note(at(0, "08:01"), "A new tooth")]],
  ["two pumps a minute apart", [pump(at(0, "08:00"), 100), pump(at(0, "08:01"), 100)]],
  ["two meals a minute apart", [meal(at(0, "08:00"), "Yoghurt"), meal(at(0, "08:01"), "Yoghurt")]],
  ["two breastfeeds started a minute apart", [breast(at(0, "08:00"), 10, "Left"), breast(at(0, "08:01"), 10, "Right")]],
  ["a 300 ml bottle someone checked", [bottle(at(0, "08:00"), 300, "Formula", { checked: true })]],
  ["a 70 min breastfeed already trimmed", [breast(at(0, "08:00"), 70, "Left", { timer_capped: true })]],
  ["a feed timer running for 3 hours that someone checked", [breast(ago(180), null, "Left", { checked: true })]],
];

/**
 * Six finished sleeps of which one is a nap, at 09:00 two days ago: `napMin` long, started
 * `before` minutes after the sleep before it ended. The others are three nights from 19:00
 * and two early-morning stretches, none of them a nap.
 */
function oneNap(before: number, napMin = 60): Draft[] {
  return [
    sleep(at(-3, "19:00"), at(-2, "01:00")),
    sleep(at(-2, "01:30"), at(-2, "09:00") - before),
    sleep(at(-2, "09:00"), at(-2, "09:00") + napMin),
    sleep(at(-2, "19:00"), at(-1, "01:00")),
    sleep(at(-1, "01:30"), at(-1, "05:00")),
    sleep(at(-1, "19:00"), at(0, "06:00")),
  ];
}

/**
 * One night from 19:00 that counts, one sleep that may count as a second night (from `start`,
 * `min` long, two evenings ago) and four short early-morning sleeps. A usual bedtime needs
 * two nights: a sleep of 2 hours or more that starts from 18:00 and before 01:00.
 */
function oneNightAnd(start: string, min: number, day = -2): Draft[] {
  return [
    sleep(at(-6, "05:10"), at(-6, "05:50")),
    sleep(at(-5, "05:10"), at(-5, "05:50")),
    sleep(at(-4, "19:00"), at(-3, "05:00")),
    sleep(at(day, start), at(day, start) + min),
    sleep(at(-1, "05:10") + (day === -1 ? 60 : 0), at(-1, "05:50") + (day === -1 ? 60 : 0)),
    sleep(at(0, "05:10"), at(0, "05:50")),
  ];
}

/** Nights from 19:00 to 07:00 and, on `naps` of the last days, one nap of an hour `before` minutes after waking. */
function napAfter(before: number, naps: number): Draft[] {
  const out: Draft[] = [];
  for (let day = -7; day <= -1; day++) {
    out.push(sleep(at(day, "19:00"), at(day + 1, "07:00")));
    if (day > -1 - naps) out.push(sleep(at(day, "07:00") + before, at(day, "07:00") + before + 60));
  }
  return out;
}

/**
 * Two naps a day on the last days, each given as [minutes awake before it, its length], with
 * nights from 19:00 to 07:00. The first nap of a day follows the morning, the second the first.
 */
function napPairs(days: [[number, number], [number, number]][]): Draft[] {
  const out: Draft[] = [sleep(at(-days.length - 1, "19:00"), at(-days.length, "07:00"))];
  days.forEach(([[before1, min1], [before2, min2]], i) => {
    const day = i - days.length;
    const first = at(day, "07:00") + before1;
    const second = first + min1 + before2;
    out.push(sleep(first, first + min1), sleep(second, second + min2), sleep(at(day, "19:00"), at(day + 1, "07:00")));
  });
  return out;
}

/** The sleep rhythm's lines, each from both sides, at one age: `hi` is the end of the usual awake window there. */
function coachEdges(hi: number): [string, Draft[]][] {
  return [
    ["one nap, 15 min after the sleep before it", oneNap(15)],
    ["one nap, 16 min after the sleep before it", oneNap(16)],
    ["one nap, 299 min after the sleep before it", oneNap(299)],
    ["one nap, 300 min after the sleep before it", oneNap(300)],
    ["one nap of 39 min", oneNap(60, 39)],
    ["one nap of 40 min", oneNap(60, 40)],
    ["her best nap comes 15 min past the usual window", oneNap(hi + 15)],
    ["her best nap comes 16 min past the usual window", oneNap(hi + 16)],
    ["five finished sleeps", oneNap(60).slice(1)],
    // Her best window is the middle of the awake times before her longest naps: the longest quarter of them, and never fewer than two.
    ["eight naps: the two longest come 60 and 200 min after waking, the third 100", napPairs([[[60, 120], [150, 40]], [[200, 110], [150, 45]], [[100, 100], [150, 50]], [[150, 55], [150, 60]]])],
    ["four naps: the two longest come 60 and 200 min after waking", napPairs([[[60, 120], [150, 40]], [[200, 110], [150, 45]]])],
    [
      "sleeps that start at 06:59, 07:00, 17:59 and 18:00, and of 239 and 240 min",
      [sleep(at(-3, "06:59"), at(-3, "07:40")), sleep(at(-3, "09:00"), at(-3, "13:00")), sleep(at(-3, "17:59"), at(-3, "18:40")), sleep(at(-2, "07:00"), at(-2, "07:45")), sleep(at(-2, "09:30"), at(-2, "13:29")), sleep(at(-2, "18:00"), at(-2, "18:50")), sleep(at(-1, "19:00"), at(0, "06:00"))],
    ],
    ["one night, and a long sleep from 17:59", oneNightAnd("17:59", 600)],
    ["one night, and a long sleep from 18:00", oneNightAnd("18:00", 600)],
    ["one night, and a sleep from 00:59", oneNightAnd("00:59", 240, -1)],
    ["one night, and a sleep from 01:00", oneNightAnd("01:00", 240, -1)],
    ["one night, and a sleep of 119 min from 20:00", oneNightAnd("20:00", 119)],
    ["one night, and a sleep of 120 min from 20:00", oneNightAnd("20:00", 120)],
    ["one night, and a night from 19:20", oneNightAnd("19:20", 300)],
    // The next nap goes by her own rhythm from six naps on, kept between 15 min under and 30 min over the usual window.
    ["six naps, each 100 min after waking", napAfter(100, 6)],
    ["five naps, each 100 min after waking", napAfter(100, 5)],
    ["six naps, each 40 min after waking", napAfter(40, 6)],
    ["six naps, each 200 min after waking", napAfter(200, 6)],
    ["six naps, each 250 min after waking", napAfter(250, 6)],
  ];
}

/** Bottles of 120 ml every `gap` minutes back from `lastAgo` minutes before 13:00, `count` of them. */
const bottlesEvery = (gap: number, count: number, lastAgo: number) => Array.from({ length: count }, (_, i) => bottle(ago(lastAgo + i * gap), 120));

/** "Coming up", where the log pushes a gap against its limits. */
const FORECAST_EDGES: [string, Draft[]][] = [
  // After a very small feed the next one comes sooner, never under an hour.
  ["feeds every 100 min, then 21 ml twenty minutes ago", [...bottlesEvery(100, 18, 120), bottle(ago(20), 21)]],
  ["feeds every 100 min, then 30 ml twenty minutes ago", [...bottlesEvery(100, 18, 120), bottle(ago(20), 30)]],
  ["diapers every 40 min", Array.from({ length: 12 }, (_, i) => diaper(ago(30 + i * 40), "Wet"))],
  ["diapers every 7 hours", Array.from({ length: 6 }, (_, i) => diaper(ago(120 + i * 420), "Wet"))],
  ["sleeps of 15 min with 20 min awake between them", Array.from({ length: 8 }, (_, i) => sleep(ago(45 + i * 35), ago(30 + i * 35)))],
];

/** How full a last feed was, and when the next is due after a 3 hour gap: the last feed is the newest in each list. */
const FULLNESS: [string, Draft[]][] = [
  ["both breasts for 5 min", [breast(ago(60), 5, "Both")]],
  ["both breasts for 8 min", [breast(ago(60), 8, "Both")]],
  ["both breasts for 20 min", [breast(ago(60), 20, "Both")]],
  ["one breast for 10 min", [breast(ago(60), 10, "Right")]],
  ["one breast for 19 min", [breast(ago(60), 19, "Left")]],
  ["one breast for 20 min", [breast(ago(60), 20, "Right")]],
  ["a breastfeed still running", [breast(ago(30), null, "Left")]],
  ["a breastfeed on both sides still running", [breast(ago(30), null, "Both")]],
  ["a breastfeed with an end and no length written", [{ ...breast(ago(60), 12, "Both"), payload: { method: "Breast", side: "Both" } }]],
  ["a bottle of 60 ml, the only one", [bottle(ago(60), 60)]],
  ["a bottle of 60 ml after one of 200: two bottles are too few for a usual", [bottle(ago(300), 200), bottle(ago(60), 60)]],
  ["a bottle of 60 ml after 100 and 140: the usual is the middle of the three, 100", [bottle(ago(500), 100), bottle(ago(300), 140), bottle(ago(60), 60)]],
  ["a bottle of 60 ml after 100, 180 and 200: the usual is between the middle two, 140", [bottle(ago(700), 100), bottle(ago(500), 180), bottle(ago(300), 200), bottle(ago(60), 60)]],
  ["bottles of 20 ml do not count towards the usual", [bottle(ago(700), 20), bottle(ago(500), 20), bottle(ago(300), 20), bottle(ago(200), 150), bottle(ago(60), 60)]],
  ["bottles of 21 ml do", [bottle(ago(700), 21), bottle(ago(500), 21), bottle(ago(300), 21), bottle(ago(200), 150), bottle(ago(60), 60)]],
  ["three bottles of 25 ml: the usual is never under 30", [bottle(ago(500), 25), bottle(ago(300), 25), bottle(ago(60), 25)]],
  ["a bottle of 88 ml after two of 120: just under three quarters", [bottle(ago(500), 120), bottle(ago(300), 120), bottle(ago(60), 88)]],
  ["a bottle of 90 ml after two of 120: three quarters", [bottle(ago(500), 120), bottle(ago(300), 120), bottle(ago(60), 90)]],
  ["a bottle with no amount", [{ ...bottle(ago(60), 0), payload: { method: "Bottle" } }]],
  ["an amount with no method written", [{ ...bottle(ago(60), 60), payload: { amount_ml: 60 } }]],
  ["no feed at all", [diaper(ago(60), "Wet")]],
];

/** The age check's lines for a finished day, written out for each row of the usual ranges. */
const RANGES = {
  "first month": { feeds: [8, 12], ml: [450, 720], wet: [6, 8], dirty: [3, 6], sleep: [840, 1020], night: [480, 540] },
  "1 to 3 months": { feeds: [7, 9], ml: [600, 900], wet: [6, 8], dirty: [0, 4], sleep: [840, 1020], night: [480, 600] },
  "3 to 6 months": { feeds: [6, 8], ml: [720, 960], wet: [6, 8], dirty: [0, 4], sleep: [720, 900], night: [540, 660] },
  "6 to 12 months": { feeds: [4, 6], ml: [600, 900], wet: [5, 7], dirty: [1, 2], sleep: [720, 900], night: [600, 720] },
} as const;
/** The ages either side of each change in the usual ranges and in what is flagged, with the row main reads there. */
const RANGE_AGES: [number, keyof typeof RANGES][] = [[4, "first month"], [5, "first month"], [30, "first month"], [31, "1 to 3 months"], [41, "1 to 3 months"], [42, "1 to 3 months"], [91, "1 to 3 months"], [92, "3 to 6 months"], [182, "3 to 6 months"], [183, "6 to 12 months"], [365, "6 to 12 months"]];

/** A finished day's totals at one step from each end of the usual ranges: -1 is one under the low end, 0 the low end, 1 the high end, 2 one over it. */
function dayAt(row: keyof typeof RANGES, step: -1 | 0 | 1 | 2, bottlesOnly: boolean): Totals {
  const r = RANGES[row];
  const v = ([lo, hi]: readonly [number, number]) => (step === -1 ? Math.max(0, lo - 1) : step === 0 ? lo : step === 1 ? hi : hi + 1);
  const feeds = v(r.feeds);
  return { breast_count: bottlesOnly ? 0 : feeds, bottle_count: bottlesOnly ? Math.max(1, feeds) : 0, bottle_ml: bottlesOnly ? v(r.ml) : 0, diapers_wet: v(r.wet), diapers_dirty: v(r.dirty), sleep_min: v(r.sleep), night_sleep_min: v(r.night) };
}
const DAY_STEPS: [string, -1 | 0 | 1 | 2][] = [["one under the low end", -1], ["at the low end", 0], ["at the high end", 1], ["one over the high end", 2]];

/** The helper's snapshot from values written by hand: each optional part there and not there, one and many. */
const SNAPSHOT_BASE: SituationInput = { name: "Lana", nowLocal: "2026-11-17 13:00", ageDays: 165, asleepSince: null, awakeSince: "2026-11-17 11:20", lastFeedAt: "2026-11-17 10:40", lastFeedMl: 120, lastFeedKind: null, nextFeedDue: "2026-11-17 13:40", lastDiaperAt: "2026-11-17 12:10", lastDiaperKind: "Wet", feedsToday: 4, diapersToday: 3, mealsToday: null, whoHas: null, plan: null, phase: null, lastNight: null, week: null };
const SNAPSHOTS: [string, Partial<SituationInput>][] = [
  ["awake, with every plain line", {}],
  ["asleep", { asleepSince: "2026-11-17 12:35", awakeSince: null }],
  ["awake and no sleep logged", { awakeSince: null }],
  ["awake since a time after now", { awakeSince: "2026-11-17 13:20" }],
  ["a breastfeed last, nothing due", { lastFeedMl: null, lastFeedKind: "breast Left", nextFeedDue: null }],
  ["an amount and a kind", { lastFeedMl: 90, lastFeedKind: "formula" }],
  ["no feed, no diaper", { lastFeedAt: null, lastDiaperAt: null, feedsToday: 0, diapersToday: 0 }],
  ["a diaper with no kind", { lastDiaperKind: null }],
  ["no meal yet", { mealsToday: 0 }],
  ["one meal", { mealsToday: 1 }],
  ["two meals, and someone has her", { mealsToday: 2, whoHas: "Noor" }],
  ["last night: one wake-up, one feed", { lastNight: { sleepMin: 615, wakes: 1, feeds: 1, longestMin: 380 } }],
  ["last night: no wake-up, no feed", { lastNight: { sleepMin: 660, wakes: 0, feeds: 0, longestMin: 660 } }],
  ["last night: three wake-ups, two feeds, under an hour", { lastNight: { sleepMin: 45, wakes: 3, feeds: 2, longestMin: 20 } }],
  ["a week with bottles", { week: { days: 7, feeds: 7, bottleMl: 420, sleepMin: 795, nightMin: 630 } }],
  ["a week on the breast only", { week: { days: 4, feeds: 8, bottleMl: 0, sleepMin: 840, nightMin: 600 } }],
  ["a plan with today's step, not ticked", { plan: { goal: "Earlier bedtime", day: 2, days: 7, todayStep: "Bath at 18:00", doneToday: false } }],
  ["a plan with no step today, ticked", { plan: { goal: "Earlier bedtime", day: 7, days: 7, todayStep: null, doneToday: true } }],
  ["a phase line", { phase: "Phase: teething window; next: 3-to-2 nap change in about 15 days. Usual awake window 105 to 150 min." }],
];

// ---- the typed phrases ------------------------------------------------------------------------

const DIAPER_KINDS = ["Wet", "Dirty", "Both"];
const MILKS = ["Morning pumped", "Night pumped", "Freezer", "Formula"];
const PHRASES = [
  "120 ml bottle",
  "Fed her a bottle of 120ml formula",
  "Lana drank 90 ml 20 min ago",
  "Log a 120 ml bottle now",
  "150 ml at 1230",
  "150 ml at 1330",
  "she took 60ml an hour ago",
  "120 ml from the freezer",
  "gave her 90 ml of frozen milk",
  "pumped 120 ml",
  "120 ml from the pharmacy",
  "5 ml",
  "450 ml bottle",
  "bottle",
  "wet diaper",
  "dirty diaper 10 mins ago",
  "wet and dirty diaper",
  "she did a poo",
  "just changed a diaper",
  "changed her diaper at 9",
  "poopy diaper half an hour ago",
  "wet diaper and 120 ml",
  "fell asleep",
  "She fell asleep 10 min ago",
  "went down for a nap",
  "went down",
  "she is sleeping",
  "she fell down",
  "fell down",
  "she fell",
  "she had a fall",
  "she has fallen",
  "woke up",
  "woke up at 6:40",
  "she's awake",
  "woke up half an hour ago",
  "napped 1 to 2:15",
  "slept 1 to 2:15",
  "napped from 11:30 till 12:10",
  "napped 19 min ago",
  "slept badly",
  "fell asleep 10 min ago and woke now",
  "Is she asleep?",
  "is she asleep",
  "did she do a poo",
  "has she had 120 ml",
  "When did she last feed?",
  "remember that she likes the blue blanket",
  "log a breastfeed on the left",
  // The small words the reader lets through.
  "he had 120 ml",
  "hes awake",
  "gave him 90 ml",
  "she has had 120 ml",
  "she was sleeping",
  "baby drank 120 ml",
  "we gave her 60 ml",
  "i fed her 150 ml",
  "add a 120 ml bottle",
  "logged a wet diaper",
  // Bottle words.
  "feed 120 ml",
  "she has drunk 100 ml",
  "finished 80 ml",
  "120 ml milk",
  "120 ml formula",
  "120 ml night pumped",
  "Lana's bottle 120 ml",
  "10 ml bottle",
  "09 ml bottle",
  "400 ml bottle",
  "401 ml bottle",
  // Diaper words.
  "change her diaper",
  "poop diaper",
  "she did a poop",
  "pooey diaper",
  "soiled diaper",
  "both diaper",
  "dirty and wet diaper",
  "wet diaper at 7.30",
  "wet diaper at 9 pm",
  // Asleep and awake.
  "she is napping",
  "started napping",
  "went down to sleep",
  "asleep now",
  "she has woken up",
  "got woken up",
  "awake, wakes up",
  "Lanas awake",
  // A finished sleep.
  "slept from 1 until 2",
  "napped 1 till 2",
  "had a nap, slept 11 to 12",
  "slept 11 to 1",
  "slept 1 to 1",
  "slept 9pm to 6am",
  "slept 6pm to 9am",
  "slept till 1 to 2",
  "slept until 1 to 2",
  "slept to 1 to 2",
  "from a nap, slept 1 to 2",
  // When it happened.
  "120 ml 2 h 15 min ago",
  "120 ml 1.5 hours ago",
  "wet diaper one hour ago",
  "wet diaper 24 hours ago",
  "wet diaper 25 hours ago",
  "woke up 90 mins ago",
  "fell asleep 5 m ago",
  "120 ml at 0915",
  "120 ml 10 min ago at 9",
  // A question is never a log, with or without its mark.
  "120 ml bottle?",
  "was she fed 120 ml",
  "she was fed 120 ml",
  "had 120 ml",
  "did a poo",
  "has woken up",
  "is awake",
  // The longest message read, and one letter more.
  `90 ml bottle${" a".repeat(33)}`,
  `90 ml bottle${" a".repeat(32)} he`,
];
/** The phrases with a clock in them are also read in the morning and at night: "1 to 2:15" means another time then. */
const CLOCK_PHRASES = ["150 ml at 1330", "changed her diaper at 9", "woke up at 6:40", "napped 1 to 2:15", "slept 1 to 2:15", "napped from 11:30 till 12:10", "wet diaper at 9 pm", "slept 9pm to 6am"];
const DIAPER_ANSWERS = ["Wet", "both.", "poo", "wet and dirty", "just dirty", "what?", "just wet", "poopy", "poop", "dirty", "dirty and wet", "Both", "WET!", "pooey", ""];

/** How a child's sex may be written. The app reads the first three rows as a girl or a boy and the rest as neither. */
const SEX_WORDS: (string | null)[] = ["Girl", "girl", "GIRL", "Female", "female", "F", "f", "Boy", "boy", "BOY", "Male", "male", "M", "m", "", " girl", "girls", "woman", "g", "Other", null];
const GIRL_WORDS = ["girl", "Female", "female", "F", "f"];
const NAMES = ["Lana", "Yusuf", "James", "Iris", "JESS", "Alex"];

/** The simple screen's lines that carry the child, her state or a count. */
const SIMPLE_KEYS = ["title", "asleep", "awake", "awakeSince", "feeding", "lastFeed", "lastDiaper", "fellAsleep", "wokeUp", "milkInFridge", "hungryNow", "hungrySoon", "sleepyNow", "sleepySoon", "listen", "todayText", "asleepNow", "awakeNow", "custodySet", "yesterday", "ago"] as const;
const LANGS = ["en", "ar", "ru"] as const;

// ---- every pinned call ------------------------------------------------------------------------

/** The functions of the adapter whose results are stored, and "inputs": the print of each generated log. */
const PINNED = [
  "inputs",
  "stageOf", "stageFor", "awakeWindow", "feedLateMin", "feedGapFor", "napsLine", "pumpingActive", "normsForAge", "checkDay", "ageLabel",
  "tipsFor", "topics", "checkEntries", "sleepCoach", "nextNap", "napWindow", "ageOutlook", "forecast", "nextFeedAt", "shortFeedHint",
  "pronouns", "possessive", "reference", "percentileOf", "percentileLabel", "simpleLine", "fmtAgo",
  "formatSituation", "formatMilk", "readQuick", "readDiaperAnswer",
  "helperSituation", "situationPhase", "helperNow", "helperStable", "daySchedule", "sleepRhythm", "redFlagCheck", "ageOutlookTool", "dueSoon",
];

/** The wake time the helper's day schedule is asked for, by log. */
const WAKE_TIMES: Record<string, string> = { normal: "07:00", sparse: "06:30", empty: "07:45", bad: "05:30", mistakes: "08:30" };
/** Measurements to place on the growth curves at each age; 0 is a measurement that was never taken. */
const GROWTH = { weight_kg: [2.5, 4, 6.4, 8, 10.5, 0], length_cm: [48, 58, 65, 72, 80, 0], head_cm: [33, 38, 42, 45, 48, 0] } as const;
const GROWTH_KINDS = ["weight_kg", "length_cm", "head_cm"] as const;
const WORK = { days: [1, 2, 3, 4, 5], from: 900, to: 1700 };

type Cases = Record<string, Record<string, unknown>>;
type Put = (fn: string, key: string, value: unknown) => void;

/** The tables, by age in days. */
async function buildTables(put: Put) {
  const noon = clockAt(ONE);
  for (let d = 0; d <= 365; d++) {
    const k = ageKey(d);
    put("ageLabel", k, calls.ageLabel({ ageDays: d }));
    put("awakeWindow", k, calls.awakeWindow({ ageDays: d }));
    put("ageOutlook", k, calls.ageOutlook({ ageDays: d }));
    // The phase line of the helper's snapshot, in a home where nothing has been logged.
    put("situationPhase", k, await calls.situationPhase({ child: childOf(d), clock: noon, home: homeOf(childOf(d)) }));
  }
  put("situationPhase", "none", await calls.situationPhase({ child: childOf(null), clock: noon, home: homeOf(childOf(null)) }));
  for (const age of AGES) {
    const k = ageKey(age);
    put("stageOf", k, calls.stageOf({ ageDays: age }));
    put("feedLateMin", k, calls.feedLateMin({ ageDays: age }));
    for (const kind of GROWTH_KINDS) {
      put("reference", `${k}/${kind}`, calls.reference({ kind, ageDays: age, sex: "Girl" }));
      put("percentileOf", `${k}/${kind}`, Object.fromEntries(GROWTH[kind].map((value) => [`${value} ${kind.slice(-2)}`, calls.percentileOf({ kind, ageDays: age, value, sex: "Girl" })])));
    }
  }
  // A girl is a girl however the word is written.
  for (const age of [5, 92, 165, 250, 365]) {
    for (const kind of GROWTH_KINDS) {
      for (const sex of GIRL_WORDS) {
        put("reference", `${ageKey(age)}/${kind}/written ${sex}`, calls.reference({ kind, ageDays: age, sex }));
        put("percentileOf", `${ageKey(age)}/${kind}/written ${sex}`, Object.fromEntries(GROWTH[kind].slice(1, 4).map((value) => [`${value} ${kind.slice(-2)}`, calls.percentileOf({ kind, ageDays: age, value, sex })])));
      }
    }
  }
  put("percentileLabel", "1 to 99", Object.fromEntries(Array.from({ length: 99 }, (_, i) => [String(i + 1), calls.percentileLabel({ p: i + 1 })])));
}

/** Every child with no log, then every log at every hour. */
async function buildChildren(put: Put) {
  const noon = clockAt(ONE);
  for (const age of [...AGES, null]) {
    const k = ageKey(age);
    const child = childOf(age);
    const some = SOME_AGES.includes(age);

    for (const [hk, t] of [["0030", 30], ...HOUR_LIST] as [string, number][]) put("stageFor", `${k}/${hk}`, calls.stageFor({ child, clock: clockAt(t) }));
    put("feedGapFor", k, Object.fromEntries([undefined, 120, 180, 240, 300].map((g) => [`type gap ${g ?? "not set"}`, calls.feedGapFor({ child, clock: noon, typeGapMin: g })])));
    put("napsLine", k, Object.fromEntries([true, false].flatMap((isToday) => [0, 1, 2, 3, 4, 5].map((n) => [`${isToday ? "today" : "an earlier day"}, ${n}`, calls.napsLine({ child, clock: noon, n, isToday })]))));
    put("pumpingActive", k, Object.fromEntries(([["never", null], ["13 days ago", 13], ["14 days ago", 14], ["14 days and 1 min ago", 14 + 1 / DAY], ["15 days ago", 15]] as [string, number | null][]).map(([name, days]) => [name, calls.pumpingActive({ child, clock: noon, lastPumpAt: days == null ? null : iso(ONE - days * DAY) })])));
    put("normsForAge", k, notedRanges(calls.normsForAge({ child, clock: noon })));
    for (const topic of calls.topics({ child, clock: noon })) put("topics", `${k}/${topic.id}`, topic);
    put("helperNow", k, await calls.helperNow({ child, clock: noon, home: homeOf(child), screen: null, situation: "" }));
    put("ageOutlookTool", k, await calls.ageOutlookTool({ child, clock: noon, home: homeOf(child) }));

    for (const [logName, log] of Object.entries(logsFor(age))) {
      // The average day of the last 7 full days, as Week and Trends hand it over.
      put("checkDay", `${k}/${logName}/week`, calls.checkDay({ child, clock: noon, totals: weekMean(log), day: ymd(-1), complete: true })?.map(noted) ?? null);
      for (const [hk, t] of HOUR_LIST) {
        const key = `${k}/${logName}/${hk}`;
        const clock = clockAt(t);
        const week = entriesAt(log, t);
        const fortnight = entriesAt(log, t, 14);
        const answers = answersOf(log, age, t, hk, logName);
        const home = homeOf(child, { answers, entries: fortnight, routine: some });
        put("inputs", key, printOf(fortnight));
        // Home and the child's page, from the week Home fetches.
        put("tipsFor", key, calls.tipsFor({ child, clock, entries: week, feedGapMin: TYPE_GAP_MIN }));
        put("checkEntries", key, calls.checkEntries({ child, clock, entries: week }));
        const nap = calls.nextNap({ child, clock, entries: week });
        put("nextNap", key, nap);
        put("forecast", key, calls.forecast({ child, clock, entries: week, typeGapMin: TYPE_GAP_MIN, work: null }));
        // The sleep rhythm fold reads the page's 14 days.
        put("sleepCoach", key, calls.sleepCoach({ child, clock, entries: fortnight }));
        // The helper, by its own loader and its own tool.
        put("helperSituation", key, await calls.helperSituation({ child, clock, home }));
        if (hk === "1300") put("daySchedule", `${key}/woke ${WAKE_TIMES[logName]}`, await calls.daySchedule({ child, clock, home, wakeTime: WAKE_TIMES[logName] }));

        if (!some) continue;
        put("sleepRhythm", key, await calls.sleepRhythm({ child, clock, home }));
        put("redFlagCheck", key, await calls.redFlagCheck({ child, clock, home, days: 1 }));
        // Today so far: nothing is judged until the day is over.
        put("checkDay", key, calls.checkDay({ child, clock, totals: totalsOf(log, 0, t), day: TODAY, complete: false })?.map(noted) ?? null);
        // The nap push reads the last 36 hours only.
        put("nextNap", `${key}/the nap push`, calls.nextNap({ child, clock, entries: entriesAt(log, t, 1.5) }));
        if (nap?.at != null && nap.since) put("napWindow", key, calls.napWindow({ child, clock, woke: nap.since, at: nap.at }));
        // A parent at work, 09:00 to 17:00 on week days: the bottle hours.
        if (hk === "1300") {
          put("forecast", `${key}/parent at work`, calls.forecast({ child, clock, entries: week, typeGapMin: TYPE_GAP_MIN, work: WORK }));
          put("nextFeedAt", `${key}/the next bottle, parent at work`, calls.nextFeedAt({ child, clock, entries: week, gapMin: 120, awayCapMin: 120, work: WORK }));
        }
        // The sentences with a pronoun or the name in them: a boy, a boy whose name ends in s, no sex, no name.
        if (logName === "bad") {
          for (const [who, other] of [["boy", childOf(age, { name: "Yusuf", sex: "Boy" })], ["boy, James", childOf(age, { name: "James", sex: "male" })], ["no sex", childOf(age, { sex: null })], ["no name", childOf(age, { name: null })]] as [string, Child][]) {
            put("tipsFor", `${key}/${who}`, calls.tipsFor({ child: other, clock, entries: week, feedGapMin: TYPE_GAP_MIN }));
            // The snapshot's "Noor has her" follows the child too.
            if (who !== "no name") put("helperSituation", `${key}/${who}`, await calls.helperSituation({ child: other, clock, home: homeOf(other, { answers: { ...answers, home_summary: { ...(answers.home_summary as object), custody: { name: "Noor" } } }, entries: fortnight }) }));
          }
        }
      }
      // 03:00: the night is not over, so "last night" is the one before.
      if (some && logName === "normal") put("helperSituation", `${k}/${logName}/0300`, await calls.helperSituation({ child, clock: clockAt(180), home: homeOf(child, { answers: answersOf(log, age, 180, "0300", logName), entries: entriesAt(log, 180, 14) }) }));
    }
  }
}

/** The hand-written cases: each line of each rule from both sides. */
async function buildEdges(put: Put) {
  const noon = clockAt(ONE);

  // The guide.
  for (const age of EDGE_AGES) {
    const child = childOf(age);
    for (const [name, drafts] of tipEdges(age)) put("tipsFor", `${ageKey(age)}/by hand/${name}`, calls.tipsFor({ child, clock: noon, entries: readAtOne(drafts), feedGapMin: TYPE_GAP_MIN }));
  }
  for (const [name, perDay] of SPURTS) put("tipsFor", `d150/by hand/feeds: ${name}`, calls.tipsFor({ child: childOf(150), clock: noon, entries: readAtOne(feedDays(perDay)), feedGapMin: TYPE_GAP_MIN }));
  for (const age of [20, 60, 300, null]) put("tipsFor", `${ageKey(age)}/by hand/feeds: ${SPURTS[0][0]}`, calls.tipsFor({ child: childOf(age), clock: noon, entries: readAtOne(feedDays(SPURTS[0][1])), feedGapMin: TYPE_GAP_MIN }));

  // The entry checks, for the youngest and the oldest baby and for a child with no birth date.
  for (const age of [5, 365, null]) {
    const child = childOf(age);
    for (const [name, drafts] of CHECK_EDGES) put("checkEntries", `${ageKey(age)}/by hand/${name}`, calls.checkEntries({ child, clock: noon, entries: readAtOne(drafts) }));
  }
  // A temperature in the log is a red flag to the helper whatever else the day holds.
  for (const age of [165, 365]) {
    const child = childOf(age);
    const entries = readAtOne([...quiet(age === 165 ? 150 : 300), note(ago(180), "Warm after the nap", { temp_c: 38.4 }), note(ago(170), "Cooler now", { temperature: 37.9 })]);
    put("redFlagCheck", `${ageKey(age)}/by hand/a temperature of 38.4 on a quiet day`, await calls.redFlagCheck({ child, clock: noon, home: homeOf(child, { entries }), days: 1 }));
    put("redFlagCheck", `${ageKey(age)}/by hand/three days asked, five entries`, await calls.redFlagCheck({ child, clock: noon, home: homeOf(child, { entries: entries.slice(0, 5) }), days: 3 }));
  }

  // The sleep rhythm and the next nap.
  for (const [age, hi, usual] of [[150, 150, 128], [300, 210, 180]] as [number, number, number][]) {
    const child = childOf(age);
    const k = ageKey(age);
    for (const [name, drafts] of coachEdges(hi)) {
      const entries = readAtOne(drafts);
      put("sleepCoach", `${k}/by hand/${name}`, calls.sleepCoach({ child, clock: noon, entries }));
      put("nextNap", `${k}/by hand/${name}`, calls.nextNap({ child, clock: noon, entries }));
    }
    // A sleep timer is taken as running for 16 hours; the last 36 hours of sleep count; a phone five minutes fast is believed.
    const naps: [string, Draft[], number][] = [
      ["asleep for 15 h 59 min", [sleep(ago(1500), ago(1400)), sleep(ago(959), null)], ONE],
      ["a sleep timer 16 h 00 min old", [sleep(ago(1500), ago(1400)), sleep(ago(960), null)], ONE],
      ["the only sleep began 35 h 59 min ago", [sleep(ago(2159), ago(2100))], ONE],
      ["the only sleep began 36 h 00 min ago", [sleep(ago(2160), ago(2100))], ONE],
      ["a sleep that ends 5 min after now", [sleep(ago(300), ago(240)), sleep(ago(60), ago(-5))], ONE],
      ["a sleep that ends 6 min after now", [sleep(ago(300), ago(240)), sleep(ago(60), ago(-6))], ONE],
      ["a sleep that starts 5 min after now", [sleep(ago(300), ago(240)), sleep(ago(-5), null)], ONE],
      ["a sleep that starts 6 min after now", [sleep(ago(300), ago(240)), sleep(ago(-6), null)], ONE],
      // By age alone the next sleep is due the middle of the usual window after waking: bedtime from 18:30 and before 05:00.
      ["the next sleep due at 18:29", [sleep(at(0, "14:00"), at(0, "18:29") - usual)], at(0, "17:00")],
      ["the next sleep due at 18:30", [sleep(at(0, "14:00"), at(0, "18:30") - usual)], at(0, "17:00")],
      ["the next sleep due at 04:59", [sleep(at(-1, "22:00"), at(0, "04:59") - usual)], at(0, "03:30")],
      ["the next sleep due at 05:00", [sleep(at(-1, "22:00"), at(0, "05:00") - usual)], at(0, "03:30")],
    ];
    for (const [name, drafts, now] of naps) put("nextNap", `${k}/by hand/${name}`, calls.nextNap({ child, clock: clockAt(now), entries: made(drafts).reverse().map((d) => rowOf(d, null)) }));
  }

  // Home's nap window: the nap rounded to five minutes, a quarter of an hour either side.
  const girl = childOf(165);
  const windows: [string, string, string, string][] = [
    ["woke 11:40, due 13:47, read at 13:00", "11:40", "13:47", "13:00"],
    ["woke 11:40, due 13:48, read at 13:00", "11:40", "13:48", "13:00"],
    ["the window opens now", "11:00", "13:15", "13:00"],
    ["due now", "11:00", "13:00", "13:00"],
    ["the window closes now", "11:00", "12:45", "13:00"],
    ["60 min past the window", "09:00", "11:45", "13:00"],
    ["61 min past the window", "09:00", "11:45", "13:01"],
    ["woke a minute ago", "12:59", "15:00", "13:00"],
    ["woke after the nap was due", "12:50", "12:30", "13:00"],
  ];
  for (const [name, woke, due, now] of windows) put("napWindow", `by hand/${name}`, calls.napWindow({ child: girl, clock: clockAt(at(0, now)), woke: iso(at(0, woke)), at: clockAt(at(0, due)).now }));

  // "Coming up", the next feed and how full the last one was.
  for (const [name, drafts] of FORECAST_EDGES) put("forecast", `d165/by hand/${name}`, calls.forecast({ child: girl, clock: noon, entries: readAtOne(drafts), typeGapMin: TYPE_GAP_MIN, work: null }));
  for (const [name, drafts] of FULLNESS) {
    const entries = readAtOne(drafts);
    const next = calls.nextFeedAt({ child: girl, clock: noon, entries, gapMin: 180, awayCapMin: null, work: null });
    put("nextFeedAt", `by hand/${name}`, next);
    const last = entries.find((e) => e.type_id === "lana.feed");
    // The hint under "Next feed" after that feed, as the child is spoken of.
    if (last && next) for (const [who, other] of [["girl", girl], ["boy", childOf(165, { sex: "Boy" })], ["no sex", childOf(165, { sex: null })]] as [string, Child][]) put("shortFeedHint", `${name}/${who}`, calls.shortFeedHint({ child: other, last, fullness: next.fullness }));
  }
  // While a parent is at work the bottle gap caps the wait.
  put("nextFeedAt", "by hand/a 4 hour gap, a 2 hour cap, a parent at work when the feed ended", calls.nextFeedAt({ child: girl, clock: noon, entries: readAtOne([bottle(at(0, "11:00"), 120)]), gapMin: 240, awayCapMin: 120, work: WORK }));
  put("nextFeedAt", "by hand/a 4 hour gap, a 2 hour cap, the parent home when the feed ended", calls.nextFeedAt({ child: girl, clock: noon, entries: readAtOne([bottle(at(0, "08:00"), 120)]), gapMin: 240, awayCapMin: 120, work: WORK }));

  // The age check on a finished day.
  for (const [age, row] of RANGE_AGES) {
    const child = childOf(age);
    const check = (totals: Totals) => calls.checkDay({ child, clock: noon, totals, day: TODAY, complete: true })?.map(noted) ?? null;
    for (const [name, step] of DAY_STEPS) put("checkDay", `${ageKey(age)}/by hand/breast only, ${name}`, check(dayAt(row, step, false)));
    if ([5, 42, 92, 183, 365].includes(age)) {
      for (const [name, step] of DAY_STEPS) put("checkDay", `${ageKey(age)}/by hand/bottles only, ${name}`, check(dayAt(row, step, true)));
      put("checkDay", `${ageKey(age)}/by hand/breast and bottle, a week's averages, no night sleep`, check({ breast_count: 24 / 7, bottle_count: 18 / 7, bottle_ml: 2600 / 7, diapers_wet: 45 / 7, diapers_dirty: 6 / 7, sleep_min: 5322 / 7, night_sleep_min: 0 }));
    }
  }

  // The helper's snapshot from values written by hand.
  for (const [name, change] of SNAPSHOTS) {
    for (const [who, child] of name === "two meals, and someone has her" ? ([["girl", girl], ["boy", childOf(165, { sex: "Boy" })], ["no sex", childOf(165, { sex: null })]] as [string, Child][]) : ([["girl", girl]] as [string, Child][])) {
      put("formatSituation", `by hand/${name}${who === "girl" ? "" : `/${who}`}`, calls.formatSituation({ child, clock: noon, input: { ...SNAPSHOT_BASE, ...change } }));
    }
  }
  // The snapshot by the helper's own loader, from answers written by hand.
  // A meal logged before the age for solids is still counted; with none that part is left out.
  const young = childOf(150);
  put("helperSituation", "d150/by hand/a meal today, before the age for solids", await calls.helperSituation({ child: young, clock: noon, home: homeOf(young, { answers: { home_summary: { ...NOTHING_LOGGED, today_counts: { "lana.meal": 1 } } } }) }));
  // "Usual day lately" needs three full days with a feed or a sleep; today never counts.
  const statDay = (day: number, feeds: number, sleepMin: number, night: [number, number, number, number] = [0, 0, 0, 0]) => ({ day: ymd(day), breast_count: feeds, bottle_count: 0, bottle_ml: 0, sleep_min: sleepMin, night_sleep_min: night[0], night_wakes: night[1], night_feeds: night[2], longest_stretch_min: night[3] });
  const fewDays = [statDay(-5, 6, 0), statDay(-3, 0, 600), statDay(-2, 0, 0, [540, 2, 1, 300]), statDay(-1, 7, 700, [600, 1, 2, 420]), statDay(0, 9, 100)];
  const weeks: [string, Record<string, unknown>, string][] = [
    ["three logged days in the week", { ok: true, night_to: "07:00", days: fewDays }, "13:00"],
    ["two logged days in the week", { ok: true, night_to: "07:00", days: fewDays.filter((d) => d.day !== ymd(-3)) }, "13:00"],
    // Until the child's night ends, "last night" is the night before; an end the app cannot read is 07:00.
    ["a night that ends at 14:00, read at 13:00", { ok: true, night_to: "14:00:00", days: fewDays }, "13:00"],
    ["a night end the app cannot read, read at 08:00", { ok: true, night_to: "2 pm", days: fewDays }, "08:00"],
    ["read at 07:00, as the night ends", { ok: true, night_to: "07:00", days: fewDays }, "07:00"],
    ["read at 06:59, a minute before the night ends", { ok: true, night_to: "07:00", days: fewDays }, "06:59"],
  ];
  for (const [name, stats, hhmm] of weeks) put("helperSituation", `d165/by hand/${name}`, await calls.helperSituation({ child: girl, clock: clockAt(at(0, hhmm)), home: homeOf(girl, { answers: { care_daily_stats: stats } }) }));
  for (const [name, milk] of [["both", { fridge_ml: 270, fridge_count: 2, freezer_ml: 360, freezer_count: 2 }], ["one bottle, one bag", { fridge_ml: 120, fridge_count: 1, freezer_ml: 150, freezer_count: 1 }], ["fridge only", { fridge_ml: 90, fridge_count: 1, freezer_ml: 0, freezer_count: 0 }], ["nothing", { fridge_ml: 0, fridge_count: 0, freezer_ml: 0, freezer_count: 0 }], ["no answer", null]] as [string, { fridge_ml: number; fridge_count: number; freezer_ml: number; freezer_count: number } | null][]) {
    put("formatMilk", name, calls.formatMilk({ milk }));
  }

  // What the helper is told with every question, and its standing instructions.
  const at0030 = clockAt(30);
  put("helperNow", "d165/at 00:30", await calls.helperNow({ child: girl, clock: at0030, home: homeOf(girl), screen: null, situation: "" }));
  for (const screen of ["home", "child", "patterns", "milk", "plan", "calendar", "simple", "somewhere else"]) put("helperNow", `d165/opened from ${screen}`, await calls.helperNow({ child: girl, clock: noon, home: homeOf(girl), screen, situation: "" }));
  put("helperNow", "d165/a carer on the simple screen, in Arabic", await calls.helperNow({ child: girl, clock: noon, home: homeOf(girl, { me: CARER }), screen: "simple", situation: "" }));
  put("helperNow", "d165/in Russian", await calls.helperNow({ child: girl, clock: noon, home: homeOf(girl, { me: { ...PARENT, member: { ...PARENT.member, lang: "ru", relationship: null } } }), screen: null, situation: "" }));
  put("helperNow", "d165/with a snapshot and an earlier chat", await calls.helperNow({ child: girl, clock: noon, home: homeOf(girl, { answers: { ask_chat_recaps: { ok: true, items: [{ id: "c1", title: "Naps", summary: "Asked about short naps; a darker room was suggested.", at: "2026-11-15T09:00:00.000Z" }, { id: "c2", title: "Untitled", summary: null, at: "2026-11-14T09:00:00.000Z" }] } } }), screen: "home", situation: "Lana right now: awake." }));
  for (const age of [null, 5, 165, 365]) put("helperStable", ageKey(age), await calls.helperStable({ child: childOf(age), clock: noon, home: homeOf(childOf(age), { routine: true }) }));
  put("helperStable", "d165/a carer, with notes and a part of the app switched off", await calls.helperStable({ child: girl, clock: noon, home: homeOf(girl, { me: CARER }) }));
  // The day schedule from odd wake times: early, late, one digit, and words the helper cannot read.
  for (const wakeTime of ["04:00", "10:30", "7:05", "half past six"]) put("daySchedule", `d165/by hand/woke ${wakeTime}`, await calls.daySchedule({ child: girl, clock: noon, home: homeOf(girl), wakeTime }));

  // What is due, as the helper passes it on: the feed's own interval row is left out, the others stay.
  const due = { ok: true, items: [{ kind: "interval", type_id: "lana.feed", module_id: "lana", subject: "Lana", label: "Feed", due_at: iso(ONE + 40), overdue: false, entry_id: "feed:11-17T10:40" }, { kind: "interval", type_id: "lana.diaper", module_id: "lana", subject: "Lana", label: "Diaper", due_at: iso(ONE - 20), overdue: true, entry_id: "diaper:11-17T09:40" }, { kind: "vaccine", module_id: "lana", subject: "Lana", label: "6 months: 2 vaccines", due_at: iso(at(18, "09:00")), overdue: false }] };
  for (const age of [165, null]) put("dueSoon", ageKey(age), await calls.dueSoon({ child: childOf(age), clock: noon, home: homeOf(childOf(age), { answers: { care_due_list: due } }), daysAhead: 30 }));
  put("dueSoon", "d165/nothing due", await calls.dueSoon({ child: girl, clock: noon, home: homeOf(girl, { answers: { care_due_list: { ok: true, items: [] } } }), daysAhead: 7 }));
}

/** Words: the typed phrases, how a sex and a name are read, the simple screen in three languages. */
function buildWords(put: Put) {
  const girl = childOf(165);
  for (const message of PHRASES) put("readQuick", `${message} @ 13:00`, calls.readQuick({ child: girl, message, nowLocal: `${TODAY}T13:00`, diaperKinds: DIAPER_KINDS, milks: MILKS }));
  for (const message of CLOCK_PHRASES) for (const hhmm of ["07:30", "21:30"]) put("readQuick", `${message} @ ${hhmm}`, calls.readQuick({ child: girl, message, nowLocal: `${TODAY}T${hhmm}`, diaperKinds: DIAPER_KINDS, milks: MILKS }));
  for (const message of DIAPER_ANSWERS) put("readDiaperAnswer", message === "" ? "(nothing typed)" : message, calls.readDiaperAnswer({ message, diaperKinds: DIAPER_KINDS }));

  for (const sex of SEX_WORDS) put("pronouns", `written ${JSON.stringify(sex)}`, calls.pronouns({ child: childOf(165, { sex }) }));
  for (const name of NAMES) put("possessive", name, calls.possessive({ name }));

  for (const lang of LANGS) {
    for (const [who, child] of [["girl", girl], ["boy", childOf(165, { name: "Yusuf", sex: "Boy" })], ["no sex", childOf(165, { sex: null })]] as [string, Child][]) {
      put("simpleLine", `${lang}/${who}`, Object.fromEntries(SIMPLE_KEYS.map((key) => [key, calls.simpleLine({ child, lang, key })])));
    }
    // A boy is a boy however the word is written; anything else reads as the first form.
    for (const sex of ["boy", "BOY", "Male", "male", "M", "m", "man", "Girl", ""]) put("simpleLine", `${lang}/written ${JSON.stringify(sex)}`, Object.fromEntries((["asleep", "asleepNow", "hungryNow"] as const).map((key) => [key, calls.simpleLine({ child: childOf(165, { sex }), lang, key })])));
    put("fmtAgo", lang, Object.fromEntries([0, 0.4, 1, 59, 59.6, 60, 61, 125, 1440, 2885].map((minutes) => [`${minutes} min`, calls.fmtAgo({ lang, minutes })])));
  }
}

async function build(): Promise<Cases> {
  const cases: Cases = {};
  const put: Put = (fn, key, value) => {
    const of = (cases[fn] ??= {});
    assert.ok(!(key in of), `${fn} > ${key} is built twice`);
    of[key] = value === undefined ? null : value;
  };
  await buildTables(put);
  await buildChildren(put);
  await buildEdges(put);
  buildWords(put);
  return cases;
}

/** Build every case with the wall clock and the dice shut, then pass it through JSON as the stored side went: a key set to undefined is no key. */
const buildWithNoWallClock = () => withNoWallClock(async () => JSON.parse(JSON.stringify(await build())) as Cases);

// ---- the fixture ------------------------------------------------------------------------------

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "golden-baby.json");

function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]));
  return v;
}

/** The fixture as text: sorted keys and one case to a line, so a diff of the file lists the cases that changed and nothing else. */
function fixtureText(cases: Cases): string {
  const meta = {
    about: "What the app's rules return for a baby (under 12 months, or no birth date), as on main. Written once by GOLDEN_WRITE=1 npm test and not written again: lib/golden-baby.test.ts checks that every key stored here is still returned and equal.",
    from: "main at 797e2e3, with only the import lines of lib/norms.ts and lib/child-guide.ts made relative",
    clock: `${TODAY} in ${TZ}, at ${HOUR_LIST.map(([h]) => `${h.slice(0, 2)}:${h.slice(2)}`).join(", ")}`,
    child: "Lana, a girl; the birth date is the clock's day less the age",
    keys: "d165 is 165 days old, none has no birth date; then the log (normal, sparse, empty, bad, and mistakes at a few ages) and the hour, or 'by hand' and what the case holds",
    ages: AGES,
    cases: Object.fromEntries(PINNED.map((fn) => [fn, Object.keys(cases[fn] ?? {}).length])),
  };
  const fns = PINNED.map((fn) => {
    const of = sorted(cases[fn]) as Record<string, unknown>;
    return `    ${JSON.stringify(fn)}: {\n${Object.entries(of).map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n")}\n    }`;
  });
  return `{\n  "meta": {\n${Object.entries(meta).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n")}\n  },\n  "cases": {\n${fns.join(",\n")}\n  }\n}\n`;
}

let built: Promise<Cases> | null = null;
const fresh = () => (built ??= buildWithNoWallClock());

interface Fixture {
  meta: { cases: Record<string, number> };
  cases: Cases;
}
let read: Fixture | null = null;
function stored(): Fixture {
  assert.ok(existsSync(FIXTURE), "lib/fixtures/golden-baby.json is missing. It is written once, from main's logic, with GOLDEN_WRITE=1 npm test.");
  return (read ??= JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture);
}

const WRITE = process.env.GOLDEN_WRITE === "1";

if (WRITE && !existsSync(FIXTURE)) {
  test("golden: write lib/fixtures/golden-baby.json", async () => {
    const text = fixtureText(await fresh());
    mkdirSync(dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, text);
    assert.deepEqual(containsStored(JSON.parse(text).cases, await fresh()), [], "what was written reads back as what was built");
    assert.equal(fixtureText(await buildWithNoWallClock()), text, "a second build gives the same text, byte for byte");
  });
} else {
  if (WRITE) {
    // A stray GOLDEN_WRITE must neither rewrite the stored results nor switch the comparing off.
    test("golden: GOLDEN_WRITE is set, and the fixture is already there", () => {
      assert.fail("lib/fixtures/golden-baby.json exists and is written once. Nothing was written, and the stored results were compared as usual. Unset GOLDEN_WRITE.");
    });
  }

  test("golden: every pinned function is built, and nothing reads the wall clock", async () => {
    assert.deepEqual(Object.keys(await fresh()).sort(), [...PINNED].sort());
  });

  test("golden: the fixture holds every case this file builds, and the counts it says it holds", async () => {
    const s = stored();
    const now = await fresh();
    assert.deepEqual(Object.keys(s.cases).sort(), [...PINNED].sort(), "the functions in the fixture");
    for (const fn of PINNED) {
      const have = new Set(Object.keys(s.cases[fn]));
      const missing = Object.keys(now[fn]).filter((k) => !have.has(k));
      assert.deepEqual(missing.slice(0, 10), [], `${fn}: ${missing.length} cases are built here and not stored`);
      assert.equal(have.size, s.meta.cases[fn], `${fn}: the fixture says ${s.meta.cases[fn]} cases and holds ${have.size}`);
    }
  });

  for (const fn of PINNED) {
    test(`golden: ${fn}${fn === "inputs" ? " (the generated logs are the ones the fixture was made from)" : ""}`, async () => {
      const want = stored().cases[fn];
      assert.ok(want && Object.keys(want).length > 0, `the fixture has no cases for ${fn}`);
      const got = (await fresh())[fn] ?? {};
      const diffs: string[] = [];
      let cases = 0;
      for (const [key, value] of Object.entries(want)) {
        const d = key in got ? containsStored(value, got[key]) : ["stored, and no longer built"];
        if (d.length) cases++;
        for (const one of d) diffs.push(`${key} > ${one}`);
      }
      assert.equal(diffs.length, 0, `${fn}: ${diffs.length} stored values differ, in ${cases} of ${Object.keys(want).length} cases.\n  ${diffs.slice(0, 15).join("\n  ")}${diffs.length > 15 ? `\n  and ${diffs.length - 15} more` : ""}`);
    });
  }
}
