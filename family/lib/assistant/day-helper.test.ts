/**
 * The helper and "{Name}'s day" (docs/AGES.md, step 2): what a saved day changes in the
 * helper's prompt, snapshot and tools, and what it must leave alone. A baby's home and a
 * toddler's home with no saved day read exactly as they did, whatever the settings and the
 * type table hold; a day turns things on one answer at a time.
 *
 * The homes are the four of toddler-helper.test.ts (Noor 400 days, Adam 563, Maya 746, Yusuf
 * 1111) and Lana at 165 days, read on 17 November 2026 in Dubai. The helper's files load
 * through the golden test's resolve hook; the database is a stand-in of this file's own, which
 * also holds the child's settings, a type row that needs a day (Potty) and the entries by id.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EntryRow, Me } from "../types.ts";
import { napPattern, nextNap, type NapPattern } from "../child-insights.ts";
import { formatSituation } from "./situation-format.ts";

register("../fixtures/golden-resolve.mjs", import.meta.url);
const tools = await import("./tools.ts");
const prompt = await import("./prompt.ts");
const situation = await import("./situation.ts");
const cron = await import("../push/cron.ts");

// ---- the homes ---------------------------------------------------------------------------------

const TZ = "Asia/Dubai";
const TODAY = "2026-11-17";
const DAY = 86_400_000;
/** An instant on the home's clock (Dubai is UTC+4 all year). */
const at = (ymd: string, hm: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh - 4, mm);
};
const iso = (ms: number) => new Date(ms).toISOString();
const ymd = (n: number) => new Date(Date.parse(TODAY) + n * DAY).toISOString().slice(0, 10);

interface Kid {
  name: string;
  sex: "Girl" | "Boy";
  ageDays: number;
  /** Naps a day in the week before. */
  naps: 0 | 1 | 2;
  /** Bottles a day (07:00 and 19:00). */
  bottles: number;
  diapers: number;
  meals: number;
}
const NOOR: Kid = { name: "Noor", sex: "Girl", ageDays: 400, naps: 2, bottles: 2, diapers: 5, meals: 4 };
const ADAM: Kid = { name: "Adam", sex: "Boy", ageDays: 563, naps: 1, bottles: 0, diapers: 4, meals: 5 };
const MAYA: Kid = { name: "Maya", sex: "Girl", ageDays: 746, naps: 1, bottles: 0, diapers: 3, meals: 5 };
const YUSUF: Kid = { name: "Yusuf", sex: "Boy", ageDays: 1111, naps: 0, bottles: 0, diapers: 0, meals: 4 };
const TODDLERS = [NOOR, ADAM, MAYA, YUSUF];
const LANA: Kid = { name: "Lana", sex: "Girl", ageDays: 165, naps: 2, bottles: 2, diapers: 5, meals: 0 };

/** A week of plain days for a child, newest first. `extra` adds rows (a cup of milk, a potty entry). */
function logOf(k: Kid, extra: Partial<EntryRow>[] = []): EntryRow[] {
  const out: EntryRow[] = [];
  let n = 0;
  const add = (type: string, from: number, to: number | null, payload: Record<string, unknown> = {}) =>
    out.push({ id: `e0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, subject_id: "s1", type_id: `lana.${type}`, occurred_at: iso(from), ended_at: to == null ? null : iso(to), payload, note: null } as unknown as EntryRow);
  for (let d = -8; d <= 0; d++) {
    const day = ymd(d);
    add("sleep", at(ymd(d - 1), "19:30"), at(day, "06:30"));
    if (k.bottles) add("feed", at(day, "07:00"), at(day, "07:15"), { method: "Bottle", amount_ml: 180, milk: "Formula" });
    if (k.naps === 2) {
      add("sleep", at(day, "09:30"), at(day, "10:45"));
      add("sleep", at(day, "14:00"), at(day, "15:15"));
    }
    if (k.naps === 1) add("sleep", at(day, "12:30"), at(day, "14:30"));
    ["08:00", "12:00", "15:30", "17:30", "10:30"].slice(0, k.meals).forEach((t) => add("meal", at(day, t), null, {}));
    ["07:10", "11:00", "13:00", "16:00", "18:30"].slice(0, k.diapers).forEach((t, i) => add("diaper", at(day, t), null, { kind: i % 2 ? "Dirty" : "Wet" }));
    if (k.bottles > 1) add("feed", at(day, "19:00"), at(day, "19:15"), { method: "Bottle", amount_ml: 180, milk: "Formula" });
  }
  for (const e of extra) out.push({ id: `e0000000-0000-4000-8000-9${String(++n).padStart(11, "0")}`, subject_id: "s1", payload: {}, note: null, ended_at: null, ...e } as EntryRow);
  return out.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
}

const ALL = { view: true, add: true, edit: true, delete: true };
function meOf(k: Kid): Me {
  return {
    ok: true,
    member: { id: "m1", user_id: "u1", email: null, display_name: "Sam", role_id: "admin", birth_date: null, relationship: "Parent", is_active: true, breastfeeds: false, lang: "en", simple_mode: false },
    role: { id: "admin", label: "Admin", description: null, sort: 1 },
    permissions: { members: ALL, lana: ALL, calendar: ALL, assistant: ALL },
    presence: null,
    work_days: [],
    household: { id: "h1", name: "Our home", timezone: TZ, currency: "AED", notes: null, milk_target_ml: 400, hidden_modules: [] },
    subjects: [{ id: "s1", name: k.name, kind: "child", sex: k.sex }],
  } as unknown as Me;
}

/** The four answers of a day; the rest of a stored day (v, saved_on) is added by `saved`. */
type Answers = { milk: "clock" | "drink" | "off"; naps: 0 | 1 | 2; diapers: "diapers" | "both" | "potty" | "off"; stores_milk: boolean };
const PLAIN: Answers = { milk: "drink", naps: 1, diapers: "diapers", stores_milk: false };
/** The settings of a child whose parents saved a day five days ago (after the child's day 366 in every toddler home here). */
const saved = (a: Partial<Answers> = {}, over: Record<string, unknown> = {}) => ({ night_from: "19:00", night_to: "07:00", day: { v: 1, ...PLAIN, ...a, saved_on: ymd(-5), saved_at: iso(at(ymd(-5), "08:12")), saved_by: "m1", ...over }, day_asked: 12, day_asked_on: ymd(-5) });

const TYPE = (key: string, label: string, i: number) => ({ id: `lana.${key}`, module_id: "lana", key, label, sort: i, has_end: key === "feed" || key === "sleep", due_after_min: key === "feed" ? 180 : null, fields: key === "diaper" ? [{ key: "kind", label: "Kind", type: "select", options: ["Wet", "Dirty", "Both"], required: true }] : [], is_active: true });
/** The rows a home has today. None has a `settings` key, as in toddler-helper.test.ts: that must read as "needs nothing". */
const TYPE_ROWS = [TYPE("feed", "Feed", 1), TYPE("sleep", "Sleep", 2), TYPE("diaper", "Diaper", 3), TYPE("meal", "Meal", 4), TYPE("pump", "Pump", 5), TYPE("note", "Note", 6)];
/** The row a later migration brings: offered only where the child's day turns it on. */
const POTTY_ROW = { id: "lana.potty", module_id: "lana", key: "potty", label: "Potty", icon: "🚽", sort: 22, has_end: false, due_after_min: null, fields: [{ key: "kind", label: "What", type: "select", options: ["Wee", "Poo", "Tried", "Accident"], required: true }], is_active: true, settings: { needs: "potty" } };

interface Home {
  log?: EntryRow[];
  /** care_subjects.settings; left out, the row has no such column (an older database). */
  settings?: unknown;
  /** The type table also holds the Potty row. */
  potty?: boolean;
  /** Bottles in the fridge. */
  stock?: number;
}

/**
 * The database as the helper reads it, at `now`. As an older database would, home_summary
 * gives the feed and the diaper a next_due at every age, to show what the helper keeps and
 * what it drops; the stash and the due list are plain.
 */
function clientOf(k: Kid, now: number, home: Home): SupabaseClient {
  const log = home.log ?? logOf(k);
  const seen = log.filter((e) => Date.parse(e.occurred_at) <= now).map((e) => (e.ended_at && Date.parse(e.ended_at) > now ? { ...e, ended_at: null } : e));
  const dayOf = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  const gap: Record<string, number> = { "lana.feed": 300, "lana.diaper": 180 };
  const last: Record<string, unknown> = {};
  for (const e of seen) if (!last[e.type_id]) last[e.type_id] = { id: e.id, occurred_at: e.occurred_at, ended_at: e.ended_at, payload: e.payload, next_due: gap[e.type_id] ? iso(Date.parse(e.occurred_at) + gap[e.type_id] * 60_000) : null };
  const todays = seen.filter((e) => dayOf(Date.parse(e.occurred_at)) === dayOf(now));
  const counts: Record<string, number> = {};
  for (const e of todays) counts[e.type_id] = (counts[e.type_id] ?? 0) + 1;
  const stats = (from: string, to: string) => {
    const days = [];
    for (let d = from; d <= to; d = new Date(Date.parse(d) + DAY).toISOString().slice(0, 10)) {
      const on = seen.filter((e) => dayOf(Date.parse(e.occurred_at)) === d);
      if (!on.length) continue;
      const mins = (e: EntryRow) => (e.ended_at ? (Date.parse(e.ended_at) - Date.parse(e.occurred_at)) / 60_000 : 0);
      const feeds = on.filter((e) => e.type_id === "lana.feed").length;
      days.push({ day: d, breast_count: 0, bottle_count: feeds, bottle_ml: feeds * 180, sleep_min: on.filter((e) => e.type_id === "lana.sleep").reduce((s, e) => s + mins(e), 0), night_sleep_min: 660, night_wakes: 0, night_feeds: 0, longest_stretch_min: 660 });
    }
    return { ok: true, night_from: "19:00:00", night_to: "07:00:00", days };
  };
  const stock = home.stock ?? 0;
  const answers: Record<string, (a: Record<string, unknown>) => unknown> = {
    home_summary: () => ({ ok: true, subject: { id: "s1", name: k.name, birth_date: ymd(-k.ageDays) }, ongoing: seen.filter((e) => !e.ended_at && e.type_id === "lana.sleep").map((e) => ({ id: e.id, type_id: e.type_id, occurred_at: e.occurred_at })), last, today_counts: counts, today_entries: todays, custody: null }),
    care_entries_list: (a) => ({ ok: true, entries: seen.filter((e) => Date.parse(e.occurred_at) >= Date.parse(String(a.p_from)) && Date.parse(e.occurred_at) < Date.parse(String(a.p_to))) }),
    care_daily_stats: (a) => stats(String(a.p_from), String(a.p_to)),
    care_due_list: () => ({ ok: true, items: [
      { kind: "interval", type_id: "lana.feed", subject: k.name, label: "Feed", due_at: iso(now + 3_600_000), overdue: true },
      { kind: "interval", type_id: "lana.diaper", subject: k.name, label: "Diaper", due_at: iso(now + 3_600_000), overdue: false },
      { kind: "vaccine", subject: k.name, label: "18 months vaccines (2)", due_at: iso(now + 5 * DAY), overdue: false },
    ] }),
    milk_list: () => ({ ok: true, fridge_ml: stock * 120, fridge_count: stock, freezer_ml: 0, freezer_count: 0, bottles: [] }),
    coach_plan_active: () => ({ ok: true, plan: null }),
    coach_plan_history: () => ({ ok: true, plans: [] }),
    memory_list: () => ({ ok: true, items: [] }),
    skill_list: () => ({ ok: true, items: [] }),
    ask_chat_recaps: () => ({ ok: true, items: [] }),
  };
  const answer = (data: unknown) => {
    const p = Promise.resolve({ data, error: null });
    return Object.assign(p, { abortSignal: () => p });
  };
  const tables: Record<string, unknown[]> = {
    care_subjects: [{ id: "s1", name: k.name, module_id: "lana", kind: "child", birth_date: ymd(-k.ageDays), profile: { sex: k.sex }, ...("settings" in home ? { settings: home.settings } : {}) }],
    care_entry_types: home.potty ? [...TYPE_ROWS, POTTY_ROW] : TYPE_ROWS,
    members: [{ id: "m1", display_name: "Sam", routine: "Works 9 to 5.", role_id: "admin", relationship: "Parent" }],
    roles: [{ id: "admin", label: "Admin" }],
    care_entries: seen.map((e) => ({ id: e.id, subject_id: e.subject_id, type_id: e.type_id, occurred_at: e.occurred_at, ended_at: e.ended_at, payload: e.payload, note: e.note })),
  };
  // A list as the golden stand-in gives it (the filters are not applied); one row by id for the tools that fix a saved entry.
  const from = (table: string) => {
    let id: unknown = null;
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => {
        if (col === "id") id = v;
        return q;
      },
      is: () => q,
      order: () => q,
      maybeSingle: () => Promise.resolve({ data: (tables[table] ?? []).find((r) => (r as { id: unknown }).id === id) ?? null, error: null }),
      then: <T>(done: (v: { data: unknown[]; error: null }) => T) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(done),
    };
    return q;
  };
  return { from, rpc: (name: string, a: Record<string, unknown> = {}) => answer(answers[name] ? answers[name](a) : null) } as unknown as SupabaseClient;
}

async function contextOf(k: Kid, now: number, home: Home = {}) {
  const ctx = await tools.loadContext(clientOf(k, now, home), meOf(k), new Date(now));
  ctx.situation = await situation.loadSituation(ctx);
  return ctx;
}
type Ctx = Awaited<ReturnType<typeof contextOf>>;
const run = async (ctx: Ctx, name: string, input: Record<string, unknown>) => {
  const t = tools.buildTools(ctx).find((x) => x.def.name === name);
  assert.ok(t, `no tool ${name}`);
  return (await t.run(input, ctx)) as Record<string, unknown>;
};
/** Everything the model is given for a home: the standing instructions, the lines of the moment, the snapshot and every tool as described. */
const told = (ctx: Ctx) => ({ stable: prompt.stableSystem(ctx), now: prompt.volatileSystem(ctx), situation: ctx.situation, tools: tools.buildTools(ctx).map((t) => t.def) });
const latest = async (ctx: Ctx) => (await run(ctx, "care_now", {})).latest_of_each_kind as { id: string; type: string; label: string; next_due: string | null }[];

/** A cup of milk logged as a feed on Saturday 14 November at 19:00, for the homes that log no bottle. */
const SATURDAY_MILK: Partial<EntryRow> = { type_id: "lana.feed", occurred_at: iso(at(ymd(-3), "19:00")), ended_at: iso(at(ymd(-3), "19:05")), payload: { method: "Bottle", amount_ml: 120 } };
const NEVER = "From 12 months milk feeds have no due time: never give a time for the next one.";

// ---- nothing moves without a day ---------------------------------------------------------------

test("a baby's home: a type that needs a day, and a day in the settings, change nothing the helper is told", async () => {
  const now = at(TODAY, "16:00");
  const plain = await contextOf(LANA, now);
  for (const home of [{ potty: true }, { settings: saved({ milk: "off", diapers: "potty", naps: 0 }) }, { potty: true, settings: saved({ diapers: "both" }), stock: 2 }] as Home[]) {
    const ctx = await contextOf(LANA, now, home);
    const base = home.stock ? await contextOf(LANA, now, { stock: home.stock }) : plain;
    assert.deepEqual(told(ctx), told(base));
    assert.deepEqual(ctx.children, base.children);
    assert.deepEqual(ctx.types.map((t) => t.id), TYPE_ROWS.map((t) => t.id));
    assert.ok(ctx.types.every((t) => ctx.allTypes.includes(t)), "the rows offered are the rows as selected, not copies");
    assert.equal(ctx.milkKept, true);
  }
  // The row is still there for an entry that has it.
  assert.ok((await contextOf(LANA, now, { potty: true })).allTypes.some((t) => t.id === "lana.potty"));
  assert.deepEqual(plain.children, [{ id: "s1", ageDays: 165, toddler: false, naps: null, lately: null, lastPumpAt: null, day: null, milkClock: true }]);
  // A baby's clock, feed line and proposals as they are: nothing is refused for a stored "no milk" under 12 months.
  assert.match(plain.situation, /^Last feed 07:00 \(180 ml\), next due about 12:00\.$/m);
  const lana = await contextOf(LANA, now, { settings: saved({ stores_milk: false }) });
  assert.equal((await run(lana, "propose_milk_add", { amount_ml: 120, location: "fridge" })).ok, true);
  assert.deepEqual(await run(lana, "propose_care_entry", { subject: "Lana", type_id: "lana.potty", payload: { kind: "Wee" } }), { error: "bad_type", known: TYPE_ROWS.map((t) => t.id) });
});

test("a toddler with no day: the type that needs one, and anything that is not a whole day, change nothing", async () => {
  const now = at(TODAY, "16:00");
  for (const k of TODDLERS) {
    const plain = await contextOf(k, now);
    assert.equal(plain.children[0].day, null, k.name);
    assert.equal(plain.children[0].milkClock, false, k.name);
    const noDay: Home[] = [
      { potty: true },
      { settings: null },
      { settings: { night_from: "19:30", night_to: "06:30" }, potty: true },
      // Not version 1, an answer that is not one of the answers, an answer missing.
      { settings: saved({}, { v: 2 }), potty: true },
      { settings: saved({ milk: "sometimes" as Answers["milk"] }), potty: true },
      { settings: saved({ naps: 3 as Answers["naps"] }), potty: true },
      { settings: saved({}, { stores_milk: "no" }), potty: true },
      // Saved before the child's day 366 by the birth date stored now: it never comes into force by itself.
      { settings: saved({ milk: "clock", diapers: "both", naps: 0 }, { saved_on: ymd(-k.ageDays + 300) }), potty: true },
    ];
    for (const home of noDay) {
      const ctx = await contextOf(k, now, home);
      assert.deepEqual(told(ctx), told(plain), `${k.name}: ${JSON.stringify(home.settings ?? null)}`);
      assert.deepEqual(ctx.children, plain.children, k.name);
      assert.ok(ctx.types.every((t) => ctx.allTypes.includes(t)), k.name);
      assert.equal(ctx.allTypes.length, home.potty ? TYPE_ROWS.length + 1 : TYPE_ROWS.length, k.name);
      assert.equal((await run(ctx, "propose_milk_add", { amount_ml: 120, location: "fridge" })).ok, true, k.name);
    }
    assert.match(told(plain).stable, new RegExp(NEVER), k.name);
    assert.doesNotMatch(told(plain).stable, /Potty/, k.name);
    for (const l of await latest(plain)) assert.equal(l.next_due, null, `${k.name}: ${l.type}`);
  }
});

// ---- milk on a clock ---------------------------------------------------------------------------

test("a clock toddler: care_now keeps the feed's next due, the snapshot names it, rule 6 and the stage line stop denying it", async () => {
  const home: Home = { settings: saved({ milk: "clock", naps: 2 }) };
  const ctx = await contextOf(NOOR, at(TODAY, "16:00"), home);
  assert.equal(ctx.children[0].milkClock, true);
  // The feed keeps its clock; the diaper's and the sleep's stay off, whatever the database says.
  const now = await latest(ctx);
  assert.equal(now.find((l) => l.type === "lana.feed")?.next_due, "2026-11-17 12:00");
  for (const l of now.filter((x) => x.type !== "lana.feed")) assert.equal(l.next_due, null, l.type);
  // A due time earlier today still prints, as on a baby's line.
  assert.match(ctx.situation, /^Last feed 07:00 \(180 ml\), next due about 12:00\.$/m);
  const v = prompt.volatileSystem(ctx);
  assert.ok(v.includes("before a nap, 3 meals a day. No number of milk feeds or wet diapers a day is expected. A low or zero count is not a warning sign; it may only mean it is not logged. The '6 wet diapers' and 'refusing feeds' red flags are for babies under 12 months. You are talking to"), v);
  assert.doesNotMatch(v, /no gap between feeds/);
  // Rule 6 loses its last sentence and nothing else; the rest of the standing instructions are the no-day home's.
  const stable = prompt.stableSystem(ctx);
  const plain = prompt.stableSystem(await contextOf(NOOR, at(TODAY, "16:00")));
  assert.doesNotMatch(stable, /never give a time/);
  assert.equal(stable, plain.replace(` ${NEVER}`, ""));
  assert.notEqual(stable, plain);
  assert.equal(stable, prompt.stableSystem(await contextOf(NOOR, at(TODAY, "21:00"), home)), "the stable block must not read the clock");
  // due_soon points at the snapshot again; the feed's own interval row is still not listed.
  const due = await run(ctx, "due_soon", { days_ahead: 7 });
  assert.equal(due.note, "The next feed is not listed here: use 'Next feed due' from the snapshot.");
  assert.deepEqual((due.items as { what: string }[]).map((i) => i.what), ["18 months vaccines (2)"]);
});

test("a clock toddler's 'next due': there when fed today, gone for a feed from days ago, and with it the clock after a week", async () => {
  const clock = saved({ milk: "clock" });
  // Fed today at 14:00, read at 15:00: due about 19:00.
  const bottle = { type_id: "lana.feed", occurred_at: iso(at(TODAY, "14:00")), ended_at: iso(at(TODAY, "14:10")), payload: { method: "Bottle", amount_ml: 150 } };
  assert.match((await contextOf(NOOR, at(TODAY, "15:00"), { settings: clock, log: logOf(NOOR, [bottle]) })).situation, /^Last feed 14:00 \(150 ml\), next due about 19:00\.$/m);
  // Last night's bottle, read before the morning one: the due time (00:00) is today's.
  assert.match((await contextOf(NOOR, at(TODAY, "06:45"), { settings: clock })).situation, /^Last feed yesterday 19:00 \(180 ml\), next due about 00:00\.$/m);
  // Last fed on Saturday: its due time was Sunday 00:00 and would read as tonight. The line stays, without it.
  const adam = await contextOf(ADAM, at(TODAY, "10:00"), { settings: clock, log: logOf(ADAM, [SATURDAY_MILK]) });
  assert.equal(adam.children[0].milkClock, true);
  assert.match(adam.situation, /^Last feed Saturday 19:00 \(120 ml\)\.$/m);
  assert.doesNotMatch(adam.situation, /next due|due about/);
  // care_now still gives the stamp whole, with its day.
  assert.equal((await latest(adam)).find((l) => l.type === "lana.feed")?.next_due, "2026-11-15 00:00");
  // No milk logged for more than a week: the family's clock has stopped, and the helper says nothing is due.
  const old = { ...SATURDAY_MILK, occurred_at: iso(at(ymd(-9), "19:00")), ended_at: iso(at(ymd(-9), "19:05")) };
  const stopped = await contextOf(ADAM, at(TODAY, "10:00"), { settings: clock, log: logOf(ADAM, [old]) });
  assert.equal(stopped.children[0].milkClock, false);
  assert.equal((await latest(stopped)).find((l) => l.type === "lana.feed")?.next_due, null);
  assert.doesNotMatch(stopped.situation, /Last feed|next due/);
  assert.match(prompt.stableSystem(stopped), new RegExp(NEVER));
  assert.ok(prompt.volatileSystem(stopped).includes(prompt.TODDLER_STAGE_END));
  assert.equal("note" in (await run(stopped, "due_soon", {})), false);
});

test("milk as a drink or not logged: no clock, as with no day", async () => {
  for (const milk of ["drink", "off"] as const) {
    const ctx = await contextOf(NOOR, at(TODAY, "16:00"), { settings: saved({ milk, naps: 2 }) });
    assert.equal(ctx.children[0].milkClock, false, milk);
    for (const l of await latest(ctx)) assert.equal(l.next_due, null, `${milk}: ${l.type}`);
    assert.match(ctx.situation, /^Last feed 07:00 \(180 ml\)\.$/m, milk);
    assert.match(prompt.stableSystem(ctx), new RegExp(NEVER), milk);
    assert.ok(prompt.volatileSystem(ctx).includes(prompt.TODDLER_STAGE_END), milk);
    assert.equal("note" in (await run(ctx, "due_soon", {})), false, milk);
  }
});

test("the snapshot, pure: 'next due' needs the family's clock and a due time of today or later", () => {
  const base = { name: "Noor", them: "her", nowLocal: "2026-11-17 15:02", ageDays: 400, toddler: true, asleepSince: null, awakeSince: null, lastFeedAt: "2026-11-17 14:00", lastFeedMl: 150, lastFeedKind: null, nextFeedDue: "2026-11-17 19:00", feedsToday: 0, diapersToday: 0, mealsToday: 0, whoHas: null, plan: null };
  const feedLine = (over: Record<string, unknown>) => formatSituation({ ...base, ...over }).split("\n")[1];
  assert.equal(feedLine({}), "Last feed 14:00 (150 ml).");
  assert.equal(feedLine({ milkClock: false }), "Last feed 14:00 (150 ml).");
  assert.equal(feedLine({ milkClock: true }), "Last feed 14:00 (150 ml), next due about 19:00.");
  assert.equal(feedLine({ milkClock: true, nextFeedDue: null }), "Last feed 14:00 (150 ml).");
  assert.equal(feedLine({ milkClock: true, lastFeedAt: "2026-11-17 08:00", nextFeedDue: "2026-11-17 13:00" }), "Last feed 08:00 (150 ml), next due about 13:00.");
  assert.equal(feedLine({ milkClock: true, lastFeedAt: "2026-11-16 21:00", nextFeedDue: "2026-11-18 02:00" }), "Last feed yesterday 21:00 (150 ml), next due about 02:00.");
  assert.equal(feedLine({ milkClock: true, lastFeedAt: "2026-11-16 14:00", nextFeedDue: "2026-11-16 19:00" }), "Last feed yesterday 14:00 (150 ml).");
  // A baby's line does not ask: it is as it was.
  assert.equal(formatSituation({ ...base, toddler: false, ageDays: 165 }).split("\n")[1], "Last feed 14:00 (150 ml), next due about 19:00.");
});

// ---- stored milk --------------------------------------------------------------------------------

test("propose_milk_add: refused while the day says no milk is stored, and only then", async () => {
  const now = at(TODAY, "10:00");
  const input = { amount_ml: 120, location: "freezer" };
  const off = await contextOf(MAYA, now, { settings: saved({ stores_milk: false }), stock: 1 });
  assert.deepEqual(await run(off, "propose_milk_add", input), { error: "no_stored_milk", message: "Maya's day says no milk is stored. A parent turns it on in Maya's day." });
  assert.equal(off.proposals.length, 0);
  // The tools are the same list as with no day, so a bag already there can still be used or binned.
  assert.deepEqual(tools.buildTools(off).map((t) => t.def), tools.buildTools(await contextOf(MAYA, now, { stock: 1 })).map((t) => t.def));
  assert.ok(tools.buildTools(off).some((t) => t.def.name === "propose_milk_move"));
  for (const home of [{ stock: 1 }, { settings: saved({ stores_milk: true }) }, { settings: saved({ stores_milk: true }), stock: 1 }, { settings: saved({ stores_milk: false }, { v: 2 }) }] as Home[]) {
    const ctx = await contextOf(MAYA, now, home);
    const r = await run(ctx, "propose_milk_add", input);
    assert.equal(r.ok, true, JSON.stringify(home));
    assert.equal(ctx.proposals.length, 1);
  }
  assert.equal((await run(await contextOf(YUSUF, now, { settings: saved({ naps: 0, diapers: "off", stores_milk: false }) }), "propose_milk_add", input)).message, "Yusuf's day says no milk is stored. A parent turns it on in Yusuf's day.");
});

test("the milk lines follow the day: none where it says no milk is stored, and none 14 days after the last pump with nothing in stock", async () => {
  const now = at(TODAY, "10:00");
  const lines = async (home: Home) => {
    const ctx = await contextOf(MAYA, now, home);
    return { kept: ctx.milkKept, stable: /Pumped milk:|Milk at home:/.test(prompt.stableSystem(ctx)), snapshot: /Milk at home/.test(ctx.situation) };
  };
  const pump = (daysAgo: number) => logOf(MAYA, [{ type_id: "lana.pump", occurred_at: iso(at(ymd(-daysAgo), "08:00")), payload: { amount_ml: 120 } }]);
  const none = { kept: false, stable: false, snapshot: false };
  const all = { kept: true, stable: true, snapshot: true };
  // No day: a bottle in stock or a pump in 14 days, as before.
  assert.deepEqual(await lines({ stock: 1 }), all);
  assert.deepEqual(await lines({}), none);
  // The day says no: nothing, even with a bottle an older build put away, or a pump last week.
  assert.deepEqual(await lines({ settings: saved({ stores_milk: false }), stock: 1 }), none);
  assert.deepEqual(await lines({ settings: saved({ stores_milk: false }), log: pump(3) }), none);
  // The day says yes: the lines still need a bottle or a pump lately.
  assert.deepEqual(await lines({ settings: saved({ stores_milk: true }), stock: 1 }), all);
  assert.deepEqual(await lines({ settings: saved({ stores_milk: true }), log: pump(13) }), all);
  assert.deepEqual(await lines({ settings: saved({ stores_milk: true }), log: pump(15) }), none);
  assert.deepEqual(await lines({ settings: saved({ stores_milk: true }) }), none);
});

// ---- naps ---------------------------------------------------------------------------------------

test("napsLately: the family's answer in their name, also with nothing logged; without one, as before", () => {
  const p = (over: Partial<NapPattern>): NapPattern => ({ toddler: true, expected: true, perDay: 1, usualNaps: 1, evidenceDays: 6, napDays: 6, napsToday: 0, ...over });
  assert.equal(tools.napsLately(p({ said: true, perDay: 2, usualNaps: 2 })), "the family says 2 naps a day");
  assert.equal(tools.napsLately(p({ said: true })), "the family says 1 nap a day");
  assert.equal(tools.napsLately(p({ said: true, expected: false, perDay: 0, usualNaps: 0 })), "the family says no nap");
  for (const n of [2, 1, 0]) assert.match(String(tools.napsLately(p({ said: true, expected: n > 0, perDay: n, usualNaps: n, evidenceDays: 0, napDays: 0 }))), /^the family says /, `${n} with nothing logged`);
  assert.equal(tools.napsLately(p({})), "1 nap a day lately");
  assert.equal(tools.napsLately(p({ perDay: 2, usualNaps: 2 })), "2 naps a day lately");
  assert.equal(tools.napsLately(p({ expected: false, perDay: 0, usualNaps: 0, napDays: 0 })), "no nap lately");
  assert.equal(tools.napsLately(p({ expected: false, perDay: 0, usualNaps: 0, napDays: 2 })), "naps on only 2 of the last 6 days logged");
  assert.equal(tools.napsLately(p({ evidenceDays: 0, napDays: 0 })), null);
  assert.equal(tools.napsLately(p({ toddler: false, perDay: null, usualNaps: null, said: true })), null);
  assert.equal(tools.napsLately(null), null);
});

test("the naps a family says: the stage line, sleep_rhythm and day_schedule go by the answer, not by the log", async () => {
  const now = at(TODAY, "13:00");
  const napLines = (r: Record<string, unknown>) => (r.lines as { what: string }[]).filter((l) => /nap/.test(l.what)).length;
  // Maya naps once a day in the log. The family says none.
  const none = await contextOf(MAYA, now, { settings: saved({ naps: 0 }) });
  assert.ok(prompt.volatileSystem(none).includes("usual now (2 to 3 years): 0 or 1 nap; most still nap until 3 (the family says no nap), awake "), prompt.volatileSystem(none));
  const day = await run(none, "day_schedule", { wake_time: "07:00" });
  assert.equal(day.note, "No nap planned: the family says no nap.");
  assert.equal(napLines(day), 0);
  assert.equal((await run(none, "sleep_rhythm", {})).naps, "the family says no nap");
  assert.equal((await run(none, "age_outlook", {})).naps, "the family says no nap");
  // The family says one: one nap planned, in their name.
  const one = await contextOf(MAYA, now, { settings: saved({ naps: 1 }) });
  assert.ok(prompt.volatileSystem(one).includes("(the family says 1 nap a day)"));
  const planned = await run(one, "day_schedule", { wake_time: "07:00" });
  assert.equal(planned.naps_a_day, 1);
  assert.equal(napLines(planned), 1);
  assert.equal("note" in planned, false);
  // Yusuf logs no nap; the family says one, and with nothing logged at all it still reads.
  const yusuf = await contextOf(YUSUF, now, { settings: saved({ naps: 1, diapers: "off" }) });
  assert.ok(prompt.volatileSystem(yusuf).includes("(the family says 1 nap a day)"));
  assert.equal((await run(yusuf, "day_schedule", { wake_time: "06:30" })).naps_a_day, 1);
  const empty = await contextOf(NOOR, now, { settings: saved({ naps: 2 }), log: [] });
  assert.ok(prompt.volatileSystem(empty).includes("usual now (12 to 18 months): 1–2 naps (the family says 2 naps a day), awake 3 h to 4 h before a nap"), prompt.volatileSystem(empty));
  // With no day the reason is the log's, as it was.
  assert.equal((await run(await contextOf(YUSUF, now), "day_schedule", { wake_time: "06:30" })).note, "No nap planned: Yusuf napped on 0 of the last 6 days logged.");
  assert.ok(prompt.volatileSystem(await contextOf(MAYA, now)).includes("(1 nap a day lately)"));
});

test("the nap push goes by the family's answer: none where they say no nap, one where they say one", () => {
  const now = at(TODAY, "11:00");
  const week = now - 7 * DAY;
  const subject = (k: Kid, settings: unknown) => ({ birth_date: ymd(-k.ageDays), settings: settings as Record<string, unknown> });
  const pattern = (k: Kid, settings: unknown) => cron.napPushPattern(logOf(k), subject(k, settings), k.ageDays, now, TZ, week);
  // Maya naps once a day in the log; the family says none: no nap is expected, so no push is sent.
  assert.equal(pattern(MAYA, {}).expected, true);
  assert.deepEqual({ ...pattern(MAYA, saved({ naps: 0 })) }, { ...pattern(MAYA, {}), expected: false, perDay: 0, usualNaps: 0, said: true });
  // Yusuf logs no nap; the family says one.
  assert.equal(pattern(YUSUF, {}).expected, false);
  assert.deepEqual({ ...pattern(YUSUF, saved({ naps: 1 })) }, { ...pattern(YUSUF, {}), expected: true, perDay: 1, usualNaps: 1, said: true });
  // No day, a day that does not count, and a baby whatever is stored: the log's own pattern, as before.
  for (const k of [...TODDLERS, LANA]) {
    // The push reads a baby's last 36 hours and a toddler's week.
    const from = k === LANA ? now - 36 * 3_600_000 : week;
    const before = napPattern(logOf(k), k.ageDays, now, TZ, from);
    const stored = [undefined, null, {}, { night_from: "19:00" }, saved({ naps: 0 }, { v: 2 }), saved({ naps: 0 }, { saved_on: ymd(-k.ageDays + 300) }), ...(k === LANA ? [saved({ naps: 0 })] : [])];
    for (const settings of stored) assert.deepEqual(cron.napPushPattern(logOf(k), subject(k, settings), k.ageDays, now, TZ, from), before, `${k.name}: ${JSON.stringify(settings ?? null)}`);
  }
  // The decision the job makes with that pattern: no push where no nap is expected, the next nap otherwise.
  const hourOf = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
    return Number(parts.find((p) => p.type === "hour")?.value ?? 0) + Number(parts.find((p) => p.type === "minute")?.value ?? 0) / 60;
  };
  const next = (k: Kid, settings: unknown, from = week) => cron.napPushNext(logOf(k), subject(k, settings), k.ageDays, now, TZ, from, hourOf);
  assert.equal(next(MAYA, saved({ naps: 0 })), null, "the family says no nap: nothing is sent, whatever the log shows");
  assert.equal(next(YUSUF, {}), null, "no nap in the log and no day: nothing is sent, as before");
  assert.notEqual(next(MAYA, {}), null, "Maya naps in the log: the push has a next nap");
  assert.notEqual(next(YUSUF, saved({ naps: 1 })), null, "the family says one nap: the push has one to go by");
  // A baby is never silenced by a stored day: the same answer as the nap rule on the log alone.
  const babyFrom = now - 36 * 3_600_000;
  assert.deepEqual(next(LANA, saved({ naps: 0 }), babyFrom), nextNap(logOf(LANA), LANA.ageDays, now, hourOf, napPattern(logOf(LANA), LANA.ageDays, now, TZ, babyFrom)));
});

// ---- potty --------------------------------------------------------------------------------------

test("potty turned on by the day: listed in the prompt, and a proposal with Wee is accepted", async () => {
  const now = at(TODAY, "16:00");
  for (const diapers of ["both", "potty"] as const) {
    const ctx = await contextOf(ADAM, now, { settings: saved({ diapers }), potty: true });
    assert.deepEqual(ctx.types.map((t) => t.id), [...TYPE_ROWS, POTTY_ROW].map((t) => t.id), diapers);
    assert.ok(prompt.stableSystem(ctx).includes("lana.note=Note, lana.potty=Potty."), diapers);
    const propose = tools.buildTools(ctx).find((t) => t.def.name === "propose_care_entry")!.def.description ?? "";
    assert.ok(propose.includes(`lana.potty "Potty" [kind (select, one of Wee | Poo | Tried | Accident, required)]`), propose);
    const r = await run(ctx, "propose_care_entry", { subject: "Adam", type_id: "lana.potty", payload: { kind: "Wee" } });
    assert.equal(r.ok, true, diapers);
    assert.equal(ctx.proposals.length, 1);
    assert.equal(ctx.proposals[0].care_entry?.type_id, "lana.potty");
    assert.equal(ctx.proposals[0].care_entry?.type_label, "Potty");
    assert.deepEqual(ctx.proposals[0].care_entry?.payload, { kind: "Wee" });
    assert.match(ctx.proposals[0].summary, /^🚽 Potty · Wee · Adam · 2026-11-17 16:00$/);
    // Its own answers only, and it still asks for one.
    assert.deepEqual(await run(ctx, "propose_care_entry", { subject: "Adam", type_id: "lana.potty", payload: { kind: "Dirty" } }), { error: "bad_option", bad: [{ field: "kind", options: ["Wee", "Poo", "Tried", "Accident"] }] });
    assert.equal((await run(ctx, "propose_care_entry", { subject: "Adam", type_id: "lana.potty", payload: {} })).error, "missing_fields");
  }
});

test("potty stays off: with the answer Diapers, under 18 months, and in a home whose type table has no Potty", async () => {
  const now = at(TODAY, "16:00");
  const off: [Kid, Home][] = [
    [ADAM, { settings: saved({ diapers: "diapers" }), potty: true }],
    [ADAM, { settings: saved({ diapers: "off" }), potty: true }],
    // Only a corrected birth date gets a potty answer under day 548: it reads as diapers.
    [NOOR, { settings: saved({ diapers: "both" }), potty: true }],
    [ADAM, { settings: saved({ diapers: "both" }) }],
  ];
  for (const [k, home] of off) {
    const ctx = await contextOf(k, now, home);
    const tag = `${k.name}: ${JSON.stringify((home.settings as { day: Answers }).day.diapers)}`;
    assert.deepEqual(ctx.types.map((t) => t.id), TYPE_ROWS.map((t) => t.id), tag);
    assert.doesNotMatch(JSON.stringify(told(ctx)), /potty/i, tag);
    assert.deepEqual(await run(ctx, "propose_care_entry", { subject: k.name, type_id: "lana.potty", payload: { kind: "Wee" } }), { error: "bad_type", known: TYPE_ROWS.map((t) => t.id) }, tag);
    assert.equal(ctx.proposals.length, 0, tag);
  }
});

test("a potty entry in a home with potty off keeps its label and can still be corrected", async () => {
  const now = at(TODAY, "16:00");
  // The family tried Potty and went back to Diapers: one entry is still in the log.
  const wee: Partial<EntryRow> = { type_id: "lana.potty", occurred_at: iso(at(TODAY, "09:40")), payload: { kind: "Wee" } };
  const ctx = await contextOf(ADAM, now, { settings: saved({ diapers: "diapers" }), potty: true, log: logOf(ADAM, [wee]) });
  assert.doesNotMatch(prompt.stableSystem(ctx), /Potty|potty/);
  assert.doesNotMatch(tools.buildTools(ctx).find((t) => t.def.name === "propose_care_entry")!.def.description ?? "", /potty/i);
  const entry = (await latest(ctx)).find((l) => l.type === "lana.potty");
  assert.equal(entry?.label, "Potty");
  // Fixing it goes by the entry's own type: its answers are checked, and a good one makes a card.
  assert.deepEqual(await run(ctx, "propose_entry_change", { entry_id: entry!.id, payload: { kind: "Dirty" } }), { error: "bad_option", bad: [{ field: "kind", options: ["Wee", "Poo", "Tried", "Accident"] }] });
  assert.deepEqual(await run(ctx, "propose_entry_change", { entry_id: entry!.id, payload: { amount_ml: 90 } }), { error: "bad_field", unknown: ["amount_ml"], fields: ["kind"] });
  const fixed = await run(ctx, "propose_entry_change", { entry_id: entry!.id, payload: { kind: "Poo" } });
  assert.equal(fixed.ok, true);
  assert.equal(ctx.proposals[0].summary, "✏️ Potty · Poo · 09:40 (was Wee · 09:40)");
  assert.equal(ctx.proposals[0].entry_change?.type_label, "Potty");
  const gone = await run(ctx, "propose_entry_delete", { entry_id: entry!.id });
  assert.equal(gone.ok, true);
  assert.equal(ctx.proposals[1].summary, "🗑️ Delete · Potty · Wee · 09:40");
  // The same in a home with no day at all.
  const plain = await contextOf(ADAM, now, { potty: true, log: logOf(ADAM, [wee]) });
  assert.equal((await latest(plain)).find((l) => l.type === "lana.potty")?.label, "Potty");
  assert.doesNotMatch(prompt.stableSystem(plain), /Potty|potty/);
});
