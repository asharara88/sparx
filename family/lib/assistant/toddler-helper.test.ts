/**
 * The helper, the briefs and the pushes from 12 months (docs/AGES.md, step 1), and the baby's
 * words they must leave as they were. Four toddler homes like the walk's (WALK: Noor 400 days
 * with two naps and two bottles, Adam 563 with one nap, Maya 746 with one nap, Yusuf 1111 with
 * no nap and no diapers), each with a week of plain days, read on 17 November 2026 in Dubai.
 *
 * The helper's files import with "@/" and without ".ts", so they load through the golden
 * test's resolve hook; the database is a stand-in that answers from the rows given here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EntryRow, Me } from "../types.ts";
import { formatSituation, whenThisWeek } from "./situation-format.ts";
import { readQuick } from "./quick-log.ts";
import { matchVaccines } from "./write-match.ts";
import { selectSkills } from "./skills.ts";
import type { AssistantSkill } from "../types.ts";

register("../fixtures/golden-resolve.mjs", import.meta.url);
const tools = await import("./tools.ts");
const prompt = await import("./prompt.ts");
const situation = await import("./situation.ts");
const brief = await import("./brief.ts");
const cron = await import("../push/cron.ts");
const { addMonths, birthdayMonth } = await import("../story.ts");

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

/** A week of plain days for a child, newest first. `extra` adds rows (a cup of milk, a temperature, a pump). */
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
function meOf(k: Kid, milkTarget: number | null = 400): Me {
  return {
    ok: true,
    member: { id: "m1", user_id: "u1", email: null, display_name: "Sam", role_id: "admin", birth_date: null, relationship: "Parent", is_active: true, breastfeeds: false, lang: "en", simple_mode: false },
    role: { id: "admin", label: "Admin", description: null, sort: 1 },
    permissions: { members: ALL, lana: ALL, calendar: ALL, assistant: ALL },
    presence: null,
    work_days: [],
    household: { id: "h1", name: "Our home", timezone: TZ, currency: "AED", notes: null, milk_target_ml: milkTarget, hidden_modules: [] },
    subjects: [{ id: "s1", name: k.name, kind: "child", sex: k.sex }],
  } as unknown as Me;
}

/** The database as the helper reads it, at `now`, for one child and one log. An older database's next_due on the feed is kept, to show the helper drops it. */
function clientOf(k: Kid, log: EntryRow[], now: number, opts: { stock?: number } = {}): SupabaseClient {
  const seen = log.filter((e) => Date.parse(e.occurred_at) <= now).map((e) => (e.ended_at && Date.parse(e.ended_at) > now ? { ...e, ended_at: null } : e));
  const dayOf = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  const last: Record<string, unknown> = {};
  for (const e of seen) if (!last[e.type_id]) last[e.type_id] = { id: e.id, occurred_at: e.occurred_at, ended_at: e.ended_at, payload: e.payload, next_due: e.type_id === "lana.feed" ? iso(Date.parse(e.occurred_at) + 300 * 60_000) : null };
  const todays = seen.filter((e) => dayOf(Date.parse(e.occurred_at)) === dayOf(now));
  const counts: Record<string, number> = {};
  for (const e of todays) counts[e.type_id] = (counts[e.type_id] ?? 0) + 1;
  const stats = (from: string, to: string) => {
    const days = [];
    for (let d = from; d <= to; d = new Date(Date.parse(d) + DAY).toISOString().slice(0, 10)) {
      const on = seen.filter((e) => dayOf(Date.parse(e.occurred_at)) === d);
      if (!on.length) continue;
      const mins = (e: EntryRow) => (e.ended_at ? (Date.parse(e.ended_at) - Date.parse(e.occurred_at)) / 60_000 : 0);
      const sl = on.filter((e) => e.type_id === "lana.sleep");
      days.push({ day: d, breast_count: 0, bottle_count: on.filter((e) => e.type_id === "lana.feed").length, bottle_ml: on.filter((e) => e.type_id === "lana.feed").length * 180, sleep_min: sl.reduce((s, e) => s + mins(e), 0), night_sleep_min: 660, night_wakes: 0, night_feeds: 0, longest_stretch_min: 660 });
    }
    return { ok: true, night_from: "19:00:00", night_to: "07:00:00", days };
  };
  const answers: Record<string, (a: Record<string, unknown>) => unknown> = {
    home_summary: () => ({ ok: true, subject: { id: "s1", name: k.name, birth_date: ymd(-k.ageDays) }, ongoing: seen.filter((e) => !e.ended_at && e.type_id === "lana.sleep").map((e) => ({ id: e.id, type_id: e.type_id, occurred_at: e.occurred_at })), last, today_counts: counts, today_entries: todays, custody: null }),
    care_entries_list: (a) => ({ ok: true, entries: seen.filter((e) => Date.parse(e.occurred_at) >= Date.parse(String(a.p_from)) && Date.parse(e.occurred_at) < Date.parse(String(a.p_to))) }),
    care_daily_stats: (a) => stats(String(a.p_from), String(a.p_to)),
    care_due_list: () => ({ ok: true, items: [
      { kind: "interval", type_id: "lana.feed", subject: k.name, label: "Feed", due_at: iso(now + 3_600_000), overdue: true },
      { kind: "interval", type_id: "lana.diaper", subject: k.name, label: "Diaper", due_at: iso(now + 3_600_000), overdue: false },
      { kind: "vaccine", subject: k.name, label: "18 months vaccines (2)", due_at: iso(now + 5 * DAY), overdue: false },
    ] }),
    milk_list: () => ({ ok: true, fridge_ml: (opts.stock ?? 0) * 120, fridge_count: opts.stock ?? 0, freezer_ml: 0, freezer_count: 0, bottles: [] }),
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
    care_subjects: [{ id: "s1", name: k.name, module_id: "lana", kind: "child", birth_date: ymd(-k.ageDays), profile: { sex: k.sex } }],
    care_entry_types: ["feed", "sleep", "diaper", "meal", "pump", "note"].map((t, i) => ({ id: `lana.${t}`, module_id: "lana", key: t, label: t, sort: i, has_end: t === "feed" || t === "sleep", due_after_min: t === "feed" ? 180 : null, fields: [], is_active: true })),
    members: [{ id: "m1", display_name: "Sam", routine: "Works 9 to 5.", role_id: "admin", relationship: "Parent" }],
    roles: [{ id: "admin", label: "Admin" }],
  };
  const from = (table: string) => {
    const q = { select: () => q, eq: () => q, order: () => q, then: <T>(done: (v: { data: unknown[]; error: null }) => T) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(done) };
    return q;
  };
  return { from, rpc: (name: string, a: Record<string, unknown> = {}) => answer(answers[name] ? answers[name](a) : null) } as unknown as SupabaseClient;
}

async function contextOf(k: Kid, now: number, opts: { log?: EntryRow[]; stock?: number; milkTarget?: number | null } = {}) {
  const log = opts.log ?? logOf(k);
  const ctx = await tools.loadContext(clientOf(k, log, now, opts), meOf(k, opts.milkTarget ?? 400), new Date(now));
  ctx.situation = await situation.loadSituation(ctx);
  return ctx;
}
const run = async (ctx: Awaited<ReturnType<typeof contextOf>>, name: string, input: Record<string, unknown>) => {
  const t = tools.buildTools(ctx).find((x) => x.def.name === name);
  assert.ok(t, `no tool ${name}`);
  return (await t.run(input, ctx)) as Record<string, unknown>;
};

/** A cup of milk logged as a feed on Saturday 14 November at 19:00, for the homes that log no bottle. */
const SATURDAY_MILK: Partial<EntryRow> = { type_id: "lana.feed", occurred_at: iso(at(ymd(-3), "19:00")), ended_at: iso(at(ymd(-3), "19:05")), payload: { method: "Bottle", amount_ml: 120 } };

// ---- the snapshot -------------------------------------------------------------------------------

test("toddler snapshot: no next due, no 'No feed logged yet today.', counts only above zero", async () => {
  for (const k of TODDLERS) {
    const ctx = await contextOf(k, at(TODAY, "16:00"), { log: logOf(k, k.bottles ? [] : [SATURDAY_MILK]) });
    const s = ctx.situation;
    assert.doesNotMatch(s, /next due|due about/i, k.name);
    assert.doesNotMatch(s, /No feed logged yet/, k.name);
    assert.doesNotMatch(s, /\b0 (feeds|diapers|meals|night feeds)\b/, k.name);
    if (!k.diapers) assert.doesNotMatch(s, /diaper/i, `${k.name} logs no diapers`);
    const now = await run(ctx, "care_now", {});
    for (const l of now.latest_of_each_kind as { type: string; next_due: string | null }[]) assert.equal(l.next_due, null, `${k.name}: ${l.type}`);
    assert.match(s, /^Today so far: (\d+ (feed|diaper)s?, )*\d+ meals?\.$/m, k.name);
  }
});

test("toddler snapshot: the last feed carries its day, and goes after a week", async () => {
  // Noor's bottle of last night, read at 06:30 before the morning bottle.
  assert.match((await contextOf(NOOR, at(TODAY, "06:30"))).situation, /^Last feed yesterday 19:00 \(180 ml\)\.$/m);
  for (const k of [ADAM, MAYA, YUSUF]) {
    assert.match((await contextOf(k, at(TODAY, "10:00"), { log: logOf(k, [SATURDAY_MILK]) })).situation, /^Last feed Saturday 19:00 \(120 ml\)\.$/m, k.name);
    // With nothing in the last week, there is no last-feed line at all.
    const old = { ...SATURDAY_MILK, occurred_at: iso(at(ymd(-9), "19:00")), ended_at: iso(at(ymd(-9), "19:05")) };
    assert.doesNotMatch((await contextOf(k, at(TODAY, "10:00"), { log: logOf(k, [old]) })).situation, /Last feed/, k.name);
  }
  assert.equal(whenThisWeek("2026-11-17 07:00", "2026-11-17 10:00"), "07:00");
  assert.equal(whenThisWeek("2026-11-10 19:00", "2026-11-17 10:00"), null);
  assert.equal(whenThisWeek("2026-11-11 19:00", "2026-11-17 10:00"), "Wednesday 19:00");
});

test("toddler snapshot, pure: the toddler's lines from the same values", () => {
  const base = { name: "Maya", them: "her", nowLocal: "2026-11-17 15:02", ageDays: 746, toddler: true, asleepSince: null, awakeSince: "2026-11-17 14:30", lastFeedAt: "2026-11-16 19:00", lastFeedMl: 120, lastFeedKind: null, nextFeedDue: "2026-11-17 00:00", lastDiaperAt: "2026-11-01 08:00", lastDiaperKind: "Wet", feedsToday: 0, diapersToday: 0, mealsToday: 3, whoHas: "Wafa", plan: null, lastNight: { sleepMin: 660, wakes: 0, feeds: 0, longestMin: 660 }, week: { days: 6, feeds: 0, bottleMl: 0, sleepMin: 780, nightMin: 660 } };
  assert.equal(
    formatSituation(base),
    ["Maya right now: awake since 14:30 (32 min).", "Last feed yesterday 19:00 (120 ml).", "Today so far: 3 meals. Wafa has her.", "Last night: 11 h of sleep, longest stretch 11 h, 0 wake-ups.", "Usual day lately (6 days): 13 h of sleep, 11 h of it at night."].join("\n"),
  );
  assert.equal(formatSituation({ ...base, mealsToday: 0, whoHas: null, week: null, lastNight: null }), ["Maya right now: awake since 14:30 (32 min).", "Last feed yesterday 19:00 (120 ml)."].join("\n"));
});

test("toddler snapshot: the phase line's awake time is the stage line's", async () => {
  for (const k of TODDLERS) {
    const ctx = await contextOf(k, at(TODAY, "11:00"));
    const awake = /awake (\d+ h(?: \d+ min)? to \d+ h(?: \d+ min)?) before a nap/.exec(prompt.volatileSystem(ctx))?.[1];
    assert.ok(awake, k.name);
    assert.ok(ctx.situation.includes(`Usual awake time before a nap ${awake}.`), `${k.name}: ${ctx.situation}`);
  }
});

// ---- the prompt ---------------------------------------------------------------------------------

test("toddler stage line: no milk clock, the awake time in hours, and the closing sentence", async () => {
  for (const k of TODDLERS) {
    const v = prompt.volatileSystem(await contextOf(k, at(TODAY, "11:00")));
    assert.ok(v.includes(`${k.name} is ${k.ageDays} days old (`), k.name);
    assert.ok(v.includes(prompt.TODDLER_STAGE_END), k.name);
    assert.match(v, /before a nap[^.]*\. No number of milk feeds or wet diapers a day is expected, and no gap between feeds\. A low or zero count is not a warning sign; it may only mean it is not logged\. The '6 wet diapers' and 'refusing feeds' red flags are for babies under 12 months\./, k.name);
    assert.doesNotMatch(v, /milk feeds up to|min between sleeps|about \d+\.\d months/, k.name);
  }
  const maya = prompt.volatileSystem(await contextOf(MAYA, at(TODAY, "11:00")));
  assert.ok(maya.includes("Maya is 746 days old (2 years); usual now (2 to 3 years): 0 or 1 nap; most still nap until 3 (1 nap a day lately), awake 5 h to 6 h 30 min before a nap, 3 meals a day."), maya);
  const yusuf = prompt.volatileSystem(await contextOf(YUSUF, at(TODAY, "11:00")));
  assert.ok(yusuf.includes("Yusuf is 1111 days old (3 years); usual now (3 years and over): 0 or 1 nap; most still nap until 3 (no nap lately), awake 6 h to 7 h before a nap"), yusuf);
  const noor = prompt.volatileSystem(await contextOf(NOOR, at(TODAY, "11:00")));
  assert.ok(noor.includes("Noor is 400 days old (13 months); usual now (12 to 18 months): 1–2 naps (2 naps a day lately), awake 3 h to 4 h before a nap"), noor);
});

test("toddler stable block: rule 6 promises no next feed; milk lines only where milk is kept; never the clock", async () => {
  for (const k of TODDLERS) {
    const morning = prompt.stableSystem(await contextOf(k, at(TODAY, "07:00")));
    const night = prompt.stableSystem(await contextOf(k, at(TODAY, "21:00")));
    assert.equal(morning, night, `${k.name}: the stable block must not read the clock`);
    assert.doesNotMatch(morning, /next due|when is the next feed|the baby/, k.name);
    assert.match(morning, /never give a time for the next one/, k.name);
    assert.doesNotMatch(morning, /Pumped milk:|Milk at home:/, `${k.name}: no pump, no stock`);
  }
  // A bottle in the fridge, or a pump in the last 14 days: the milk lines are back.
  assert.match(prompt.stableSystem(await contextOf(MAYA, at(TODAY, "10:00"), { stock: 1 })), /Pumped milk: the family wants about 400 ml[\s\S]*Milk at home:/);
  const pump = { type_id: "lana.pump", occurred_at: iso(at(ymd(-13), "08:00")), payload: { amount_ml: 120 } };
  assert.match(prompt.stableSystem(await contextOf(MAYA, at(TODAY, "10:00"), { log: logOf(MAYA, [pump]) })), /Milk at home:/);
  const old = { ...pump, occurred_at: iso(at(ymd(-15), "08:00")) };
  assert.doesNotMatch(prompt.stableSystem(await contextOf(MAYA, at(TODAY, "10:00"), { log: logOf(MAYA, [old]) })), /Milk at home:/);
  // And the milk line of the snapshot goes with them.
  assert.doesNotMatch((await contextOf(MAYA, at(TODAY, "10:00"))).situation, /Milk at home/);
  assert.match((await contextOf(MAYA, at(TODAY, "10:00"), { stock: 1 })).situation, /Milk at home: fridge 120 ml in 1 bottle/);
});

test("a baby's stable block keeps its milk lines with an empty fridge and no pump", async () => {
  const s = prompt.stableSystem(await contextOf(LANA, at(TODAY, "10:00")));
  assert.match(s, /Pumped milk: the family wants about 400 ml in the fridge for the day\./);
  assert.match(s, /6\. The situation lines in the context already hold the latest state \(asleep or awake, last feed, next due, today's counts\)\. Use them for "is the baby asleep" and "when is the next feed"/);
  const v = prompt.volatileSystem(await contextOf(LANA, at(TODAY, "10:00")));
  assert.ok(v.includes("Lana is 165 days old (23 weeks, about 5.4 months); usual now (3 to 6 months): 3–4 naps, awake 105 to 150 min between sleeps, milk feeds up to about every 3 h. You are talking to Sam"), v);
});

// ---- the tools ----------------------------------------------------------------------------------

test("red_flag_check for a toddler: no 'ok', the note, and a temperature still a red flag", async () => {
  for (const k of TODDLERS) {
    const fever = { type_id: "lana.note", occurred_at: iso(at(ymd(-1), "15:00")), payload: { temp_c: 38.6 } };
    const r = await run(await contextOf(k, at(TODAY, "16:00"), { log: logOf(k, k === MAYA ? [fever] : []) }), "red_flag_check", { days: 2 });
    assert.equal(r.ok, null, k.name);
    assert.equal(r.note, tools.TODDLER_NO_CHECKS, k.name);
    assert.deepEqual(r.flags, k === MAYA ? [{ level: "red", title: "temperature 38.6 °C at 2026-11-16 15:00" }] : [], k.name);
    const def = tools.buildTools(await contextOf(k, at(TODAY, "16:00"))).find((t) => t.def.name === "red_flag_check")!.def;
    assert.ok(def.description?.includes(tools.TODDLER_NO_CHECKS), k.name);
    assert.doesNotMatch(def.description ?? "", /few wet diapers|few feeds/, k.name);
  }
});

test("day_schedule plans the child's own naps: none for a child who does not nap", async () => {
  const naps = (r: Record<string, unknown>) => (r.lines as { what: string }[]).filter((l) => /nap/.test(l.what)).length;
  const yusuf = await run(await contextOf(YUSUF, at(TODAY, "13:00")), "day_schedule", { wake_time: "06:30" });
  assert.equal(naps(yusuf), 0);
  assert.equal(yusuf.note, "No nap planned: Yusuf napped on 0 of the last 6 days logged.");
  assert.doesNotMatch(JSON.stringify(yusuf), /feed|bottle/);
  // Maya at 2 years who has stopped napping: no nap either, though her age still allows one.
  const noNaps = logOf({ ...MAYA, naps: 0 });
  assert.equal(naps(await run(await contextOf(MAYA, at(TODAY, "13:00"), { log: noNaps }), "day_schedule", { wake_time: "07:00" })), 0);
  for (const k of [ADAM, MAYA]) {
    const r = await run(await contextOf(k, at(TODAY, "13:00")), "day_schedule", { wake_time: "07:00" });
    assert.equal(naps(r), 1, k.name);
    assert.equal(r.naps_a_day, 1, k.name);
    assert.match(String(r.awake_before_a_nap), /^\d+ h( \d+ min)?$/, k.name);
    assert.doesNotMatch(JSON.stringify(r), /feed|bottle/, k.name);
  }
  const adam = await run(await contextOf(ADAM, at(TODAY, "13:00")), "day_schedule", { wake_time: "07:00" });
  assert.ok(adam.basedOn === "age norm" || adam.basedOn === "his best recent window", String(adam.basedOn));
  const noor = await run(await contextOf(NOOR, at(TODAY, "13:00")), "day_schedule", { wake_time: "06:30" });
  assert.ok(naps(noor) <= 2);
  assert.ok((noor.lines as { what: string }[]).every((l) => l.what !== "wake and feed"));
});

test("sleep_rhythm for a child with no daytime nap: the one tip and only the usual bedtime", async () => {
  const r = await run(await contextOf(YUSUF, at(TODAY, "13:00")), "sleep_rhythm", {});
  assert.deepEqual(r.rhythm, { tip: "No daytime naps in the last 14 days.", "Usual bedtime": "19:30" });
  assert.equal(r.usual_awake_before_a_nap, "6 h to 7 h");
  assert.equal(r.naps, "no nap lately");
  const maya = await run(await contextOf(MAYA, at(TODAY, "13:00")), "sleep_rhythm", {});
  const rhythm = maya.rhythm as Record<string, unknown>;
  assert.equal(rhythm["Usual nap"], "2 h");
  assert.doesNotMatch(JSON.stringify(maya), /\d min awake|_min"/);
});

test("due_soon for a toddler: no feed note, no feed or diaper clock; the vaccine stays", async () => {
  for (const k of TODDLERS) {
    const r = await run(await contextOf(k, at(TODAY, "10:00")), "due_soon", { days_ahead: 7 });
    assert.equal("note" in r, false, k.name);
    assert.deepEqual((r.items as { what: string }[]).map((i) => i.what), ["18 months vaccines (2)"], k.name);
  }
  const lana = await run(await contextOf(LANA, at(TODAY, "10:00")), "due_soon", { days_ahead: 7 });
  assert.equal(lana.note, "The next feed is not listed here: use 'Next feed due' from the snapshot.");
  assert.deepEqual((lana.items as { what: string }[]).map((i) => i.what), ["Diaper", "18 months vaccines (2)"]);
});

test("age_outlook for a toddler: the age in words, the awake time in hours", async () => {
  const r = await run(await contextOf(ADAM, at(TODAY, "10:00")), "age_outlook", {});
  assert.equal(r.age, "18 months");
  assert.equal(r.usual_awake_before_a_nap, "5 h to 6 h");
  assert.equal("ageMonths" in r, false);
  assert.equal("awakeWindowMin" in r, false);
});

// ---- the briefs ---------------------------------------------------------------------------------

test("toddler briefs: the name, no night feeds, a kind only when logged lately, no usual number", async () => {
  for (const k of TODDLERS) {
    const ctx = await contextOf(k, at(TODAY, "07:30"));
    const asks = [brief.dayAsk(ctx, "morning"), brief.dayAsk(ctx, "evening"), brief.weekAsk(ctx, ctx.subjects)];
    for (const a of asks) {
      assert.doesNotMatch(a, /the baby|night feeds|against the week|next meal/, `${k.name}: ${a}`);
      assert.match(a, /from 12 months there is none/, k.name);
    }
    assert.ok(asks[1].includes(`${k.name}'s day in numbers`), asks[1]);
    if (!k.diapers) assert.doesNotMatch(asks.join(" "), /diapers/, k.name);
    if (!k.bottles) assert.doesNotMatch(asks.join(" "), /milk feeds|pumping/, k.name);
    assert.match(asks[2], new RegExp(`what ${k.sex === "Boy" ? "his" : "her"} age usually brings`), k.name);
  }
  // Pumping in the morning brief only when a pump was logged.
  const pump = { type_id: "lana.pump", occurred_at: iso(at(ymd(-2), "08:00")), payload: { amount_ml: 100 } };
  assert.match(brief.dayAsk(await contextOf(NOOR, at(TODAY, "07:30"), { log: logOf(NOOR, [pump]) }), "morning"), /milk for the day if the log shows pumping/);
  assert.doesNotMatch(brief.dayAsk(await contextOf(NOOR, at(TODAY, "07:30")), "morning"), /pumping/);
  // A toddler's month names only the numbers it has.
  const ctx = await contextOf(YUSUF, at(TODAY, "07:30"));
  assert.ok(brief.storyAsk(ctx, ctx.subjects[0], 36, false, { feeds: false, sleep: true, diapers: false }).includes("a few numbers (sleep, the longest stretch, weight if given)"));
});

test("a baby's briefs ask what they always asked", async () => {
  const ctx = await contextOf(LANA, at(TODAY, "07:30"));
  assert.equal(
    brief.dayAsk(ctx, "morning"),
    `Write this morning's brief for Sam. Cover, in this order and only if there is something to say: how the night went for the baby (sleep stretches, night feeds, wake-ups; what is still running now); milk for the day if the log shows pumping (ml pumped since last evening against the household target of 400 ml, and what has already gone into bottles); who is home today and who is working; what is on today's calendar; anything due or overdue (treatments, next meal). Under 150 words. Short lines or bullets. Cite with [entry:ID] / [event:ID] as instructed. If a section has nothing, leave it out rather than saying "nothing".`,
  );
  assert.equal(
    brief.dayAsk(ctx, "evening"),
    `Write this evening's digest of what happened today for Sam: the baby's day in numbers (feeds and ml or minutes, naps and total sleep, diapers, medicine) and anything unusual against the week; what is on tomorrow's calendar and who is home; what is due tomorrow. Under 150 words. Short lines or bullets. Cite with [entry:ID] / [event:ID] as instructed. Leave out empty sections.`,
  );
  assert.equal(
    brief.weekAsk(ctx, ctx.subjects),
    `Write "This week for Lana" for Sam: a short weekly note. In this order: 1) what her age usually brings this week (from the week calendar and the age outlook: the week she is in, the stretch it belongs to, what is coming and in how many days or weeks), in two or three plain sentences; 2) how last week went in numbers (feeds, sleep, longest stretch, diapers) and one thing that stands out, citing [entry:ID] only where the data gives ids; 3) one or two gentle things to try this week, from the sleep rhythm and the play ideas given (name the idea); 4) anything due in the next 10 days (vaccines, appointments). Under 160 words, short lines. No diagnoses, no doses. Leave out empty sections.`,
  );
  assert.equal(
    brief.storyAsk(ctx, ctx.subjects[0], 5, true, null),
    `Write "Lana's month 5" for Sam: a short keepsake page about this month of her life so far, in the second person plural ("you") to the family. Warm, plain, no baby-talk and no exclamation marks. In this order: 1) her firsts this month, by name and date, if any; 2) how the days went in a few numbers (feeds, sleep, the longest stretch, diapers, weight if given), as a sentence or two, not a list; 3) what you tried together (name two or three of the ideas tried, if any); 4) one or two sentences on what this age usually brings next. Between 120 and 180 words. No diagnoses, no doses, no advice beyond "what comes next". Leave out empty sections without comment.`,
  );
});

// ---- the pushes ---------------------------------------------------------------------------------

test("the monthly push says the age in words: years from 2", () => {
  const title = (k: Kid, m: number) => {
    const birth = ymd(-k.ageDays);
    const day = addMonths(birth, m);
    assert.equal(birthdayMonth(birth, day), m);
    return cron.birthdayTitle(k.name, birth, day, m);
  };
  assert.equal(title(NOOR, 13), "Noor is 13 months old today");
  assert.equal(title(ADAM, 18), "Adam is 18 months old today");
  assert.equal(title(MAYA, 24), "Maya is 2 years old today");
  assert.equal(title(MAYA, 30), "Maya is 2 years 6 months old today");
  assert.equal(title(YUSUF, 36), "Yusuf is 3 years old today");
  // A baby's monthly birthdays read as they always did (Lana, born 5 June 2026).
  for (let m = 1; m <= 23; m++) assert.equal(cron.birthdayTitle("Lana", "2026-06-05", addMonths("2026-06-05", m), m), `Lana is ${m} month${m === 1 ? "" : "s"} old today`);
});

test("the nap push: a baby's words as before, a toddler's awake times in hours", () => {
  assert.equal(cron.napPushBody({ awakeMin: 115, windowMin: 128, basis: "her age" }, false, "her"), "Awake 115 min; her window is about 128 min (her age). Start the wind-down.");
  assert.equal(cron.napPushBody({ awakeMin: 330, windowMin: 345, basis: "her rhythm" }, true, "his"), "Awake 5 h 30 min; his window is about 5 h 45 min (his rhythm). Start the wind-down.");
});

// ---- the free reader, the vaccines, the skills -------------------------------------------------

test("the free reader: a fall is not a sleep (X6); falling asleep still is", () => {
  const V = { name: "Maya", diaperKinds: ["Wet", "Dirty", "Both"], milks: ["Formula"] };
  const NOW = "2026-11-17T15:00";
  for (const s of ["she fell down", "fell down", "Maya fell", "she had a fall", "he has fallen", "fell down 10 min ago"]) assert.equal(readQuick(s, NOW, V), null, s);
  assert.deepEqual(readQuick("she fell asleep", NOW, V), { kind: "sleep_start", when: { agoMin: 0 } });
  assert.deepEqual(readQuick("fell asleep 10 min ago", NOW, V), { kind: "sleep_start", when: { agoMin: 10 } });
  assert.deepEqual(readQuick("went down for a nap", NOW, V), { kind: "sleep_start", when: { agoMin: 0 } });
  assert.deepEqual(readQuick("she went down", NOW, V), { kind: "sleep_start", when: { agoMin: 0 } });
});

test("matchVaccines: a dose from before the family joined is never picked by default, and is found by name", () => {
  const book = [
    { id: "b1", visit: "Birth", vaccine: "BCG", status: "earlier" },
    { id: "b2", visit: "Birth", vaccine: "Hepatitis B", status: "earlier" },
    { id: "m12", visit: "12 months", vaccine: "MMR", status: "due" },
    { id: "m18", visit: "18 months", vaccine: "MMR", status: "upcoming" },
  ];
  const due = matchVaccines(book, "");
  assert.equal(due.ok && due.visit, "12 months");
  assert.deepEqual(due.ok && due.items.map((v) => v.id), ["m12"]);
  const bcg = matchVaccines(book, "BCG");
  assert.deepEqual(bcg.ok && bcg.items.map((v) => v.id), ["b1"]);
  const birth = matchVaccines(book, "birth");
  assert.deepEqual(birth.ok && birth.items.map((v) => v.id), ["b1", "b2"]);
  assert.deepEqual(matchVaccines(book.slice(0, 2), ""), { ok: false, error: "nothing_due", visits: ["Birth"] });
});

test("a skill written for babies is not carried past the first birthday by the margin", () => {
  const mk = (id: string, to: number | null): AssistantSkill => ({ id, title: id, when: "", triggers: ["cot"], body: "x", sources: "", always_on: false, age_from_days: null, age_to_days: to, sort: 1, is_active: true }) as AssistantSkill;
  const skills = [mk("safe_sleep", 365), mk("teething", 900), mk("solids", 400)];
  const routed = (ageDays: number) => selectSkills("which cot", skills, { ageDays }).routed.map((s) => s.id).sort();
  assert.deepEqual(routed(365), ["safe_sleep", "solids", "teething"]);
  assert.deepEqual(routed(366), ["solids", "teething"]);
  assert.deepEqual(routed(380), ["solids", "teething"]);
  assert.deepEqual(routed(421), ["solids", "teething"], "a toddler's skill keeps its margin");
  assert.deepEqual(routed(422), ["teething"]);
});
