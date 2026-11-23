import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOutlook, awakeWindow, daySchedule, growthSpurt, napPattern, nextNap, sleepCoach } from "./child-insights.ts";
import type { EntryRow } from "./types.ts";

const D = 86_400_000;
const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 13, 12, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const row = (type_id: string, at: number, end: number | null = null): EntryRow => ({ id: `${type_id}-${at}`, type_id, type_label: type_id, icon: null, occurred_at: iso(at), ended_at: end == null ? null : iso(end), payload: {}, note: null });
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const hourOf = (s: string) => new Date(s).getUTCHours() + new Date(s).getUTCMinutes() / 60;

test("awake window grows with age", () => {
  assert.deepEqual(awakeWindow(30, null), [45, 60]);
  assert.deepEqual(awakeWindow(130, null), [105, 150]);
});

test("growth spurt: two busy days after five usual ones", () => {
  const feeds: EntryRow[] = [];
  for (let d = 3; d <= 7; d++) for (let i = 0; i < 6; i++) feeds.push(row("lana.feed", NOW - d * D + i * H));
  for (let d = 1; d <= 2; d++) for (let i = 0; i < 8; i++) feeds.push(row("lana.feed", NOW - d * D + i * H));
  const g = growthSpurt(feeds, dayOf, NOW)!;
  assert.equal(g.recentPerDay, 8);
  assert.equal(g.beforePerDay, 6);
  // Same count every day: no spurt.
  const flat = feeds.filter((e) => Date.parse(e.occurred_at) < NOW - 3 * D);
  assert.equal(growthSpurt(flat, dayOf, NOW), null);
});

test("sleep coach finds nap length, best window and bedtime", () => {
  const sleeps: EntryRow[] = [];
  for (let d = 1; d <= 7; d++) {
    const base = NOW - d * D - 4 * H; // 08:00 UTC
    sleeps.push(row("lana.sleep", base, base + 1.5 * H)); // 08:00–09:30
    sleeps.push(row("lana.sleep", base + 3.5 * H, base + 4 * H)); // 11:30–12:00, after 2 h awake, short
    sleeps.push(row("lana.sleep", base + 6 * H, base + 7.5 * H)); // 14:00–15:30, after 2 h awake, long
    sleeps.push(row("lana.sleep", base + 11.5 * H, base + 20 * H)); // 19:30–04:00 night
  }
  const c = sleepCoach(sleeps, 130, hourOf, "Girl", null)!;
  assert.equal(c.napMin, 90);
  assert.equal(c.bestWindowMin, 120);
  assert.equal(c.bedtime, "19:30");
  assert.ok(c.naps >= 14);
  assert.equal(sleepCoach(sleeps.slice(0, 4), 130, hourOf, "Girl", null), null);
});

test("age outlook: phases now and next", () => {
  const o = ageOutlook(131); // about 4.3 months
  assert.ok(o.now.some((w) => w.startsWith("4-month sleep change")));
  assert.ok(o.now.some((w) => w.startsWith("Teething window")));
  assert.equal(o.next[0].what.startsWith("Solids readiness"), true);
  assert.equal(o.next[0].inAboutDays, 34);
  assert.equal(o.ageMonths, 4.3);
});

test("day schedule: naps after the awake window, bedtime between 18:30 and 20:30", () => {
  const s = daySchedule(7 * 60, 131, 110, null);
  assert.equal(s.awakeWindowMin, 110);
  assert.equal(s.basedOn, "her best recent window");
  assert.equal(s.lines[0].at, "07:00");
  assert.equal(s.lines[1].at, "08:50"); // first nap after 110 min
  const bed = s.lines[s.lines.length - 1];
  assert.equal(bed.what, "asleep for the night");
  assert.ok(bed.at >= "18:30" && bed.at <= "20:30");
  assert.equal(daySchedule(7 * 60, 131, null, null).basedOn, "age norm");
});

test("nextNap: last wake-up plus her window; asleep means no prediction; evening means bedtime", () => {
  // Six naps over three days with 90 minutes awake before the long ones, so her rhythm is known.
  const rows: EntryRow[] = [];
  for (let d = 3; d >= 1; d--) {
    const base = NOW - d * D - 3 * H; // 09:00 UTC that day
    rows.push(row("lana.sleep", base, base + 45 * 60_000));
    rows.push(row("lana.sleep", base + 45 * 60_000 + 90 * 60_000, base + 45 * 60_000 + 90 * 60_000 + 80 * 60_000));
  }
  const lastWake = NOW - 30 * 60_000;
  rows.push(row("lana.sleep", lastWake - 40 * 60_000, lastWake));
  // A baby: the pattern is not read, and gives the same window whatever it says.
  const pattern = (es: EntryRow[], now: number) => napPattern(es, 130, now, "UTC", now - 7 * D);
  const n = nextNap(rows, 130, NOW, hourOf, pattern(rows, NOW))!;
  assert.equal(n.asleepSince, null);
  assert.equal(n.basis, "her rhythm");
  assert.equal(n.windowMin, 90);
  assert.equal(n.at, lastWake + 90 * 60_000);
  assert.equal(n.awakeMin, 30);
  assert.equal(n.isBedtime, false);
  // Asleep now: nothing to predict.
  const asleepRows = [...rows, row("lana.sleep", NOW - 10 * 60_000, null)];
  const asleep = nextNap(asleepRows, 130, NOW, hourOf, pattern(asleepRows, NOW))!;
  assert.equal(asleep.asleepSince, iso(NOW - 10 * 60_000));
  assert.equal(asleep.at, null);
  // No rhythm yet: the age norm, and a wake-up at 17:30 points to bedtime.
  const evening = Date.UTC(2026, 9, 13, 17, 30);
  const eveningRows = [row("lana.sleep", evening - H, evening)];
  const e = nextNap(eveningRows, 130, evening + 10 * 60_000, hourOf, pattern(eveningRows, evening + 10 * 60_000))!;
  assert.equal(e.basis, "her age");
  assert.equal(e.windowMin, 128);
  assert.equal(e.isBedtime, true);
  assert.equal(nextNap([], 130, NOW, hourOf, pattern([], NOW)), null);
});

test("napPattern with the family's answer: it stands in for the pattern; the counts stay the log's", () => {
  // A week of one nap a day (10:00 to 11:00 UTC) and the nights, and one nap already had today.
  const rows: EntryRow[] = [];
  for (let d = 6; d >= 1; d--) {
    const base = NOW - d * D - 2 * H;
    rows.push(row("lana.sleep", base, base + H), row("lana.sleep", base + 9 * H, base + 20 * H));
  }
  rows.push(row("lana.sleep", NOW - 2 * H, NOW - H));
  const pattern = (age: number, said?: 0 | 1 | 2 | null) => napPattern(rows, age, NOW, "UTC", NOW - 7 * D, said);
  const log = pattern(400);
  assert.deepEqual(log, { toddler: true, expected: true, perDay: 1, usualNaps: 1, evidenceDays: 6, napDays: 6, napsToday: 1 });
  assert.deepEqual(pattern(400, 2), { ...log, perDay: 2, usualNaps: 2, said: true });
  assert.deepEqual(pattern(400, 1), { ...log, said: true });
  assert.deepEqual(pattern(400, 0), { ...log, expected: false, perDay: 0, usualNaps: 0, said: true });
  // No answer is the log's pattern as before, with no flag on it.
  assert.deepEqual(pattern(400, null), log);
  assert.deepEqual(pattern(400, undefined), log);
  assert.ok(!("said" in pattern(400, null)) && !("said" in napPattern(rows, 400, NOW, "UTC", NOW - 7 * D)));
  // With nothing logged at all the answer still decides: at 3 years the log alone expects no nap.
  const empty = (said?: 0 | 1 | 2) => napPattern([], 1111, NOW, "UTC", NOW - 7 * D, said);
  assert.deepEqual([empty().expected, empty(1).expected, empty(1).perDay, empty(0).expected], [false, true, 1, false]);
  // The next nap follows it: none planned for "none", bedtime once the said naps are had.
  assert.equal(nextNap(rows, 400, NOW, hourOf, pattern(400, 0))!.at, null);
  assert.equal(nextNap(rows, 400, NOW, hourOf, pattern(400, 1))!.isBedtime, true);
  assert.equal(nextNap(rows, 400, NOW, hourOf, pattern(400, 2))!.isBedtime, false);
});

test("napPattern for a baby does not read the family's answer", () => {
  const rows: EntryRow[] = [];
  for (let d = 3; d >= 1; d--) rows.push(row("lana.sleep", NOW - d * D - 2 * H, NOW - d * D - H));
  for (const age of [null, 0, 130, 365]) {
    const base = napPattern(rows, age, NOW, "UTC", NOW - 7 * D);
    assert.deepEqual(base, { toddler: false, expected: true, perDay: null, usualNaps: null, evidenceDays: 3, napDays: 3, napsToday: 0 }, `day ${age}`);
    for (const said of [0, 1, 2, null] as const) {
      const p = napPattern(rows, age, NOW, "UTC", NOW - 7 * D, said);
      assert.deepEqual(p, base, `day ${age} said ${said}`);
      assert.ok(!("said" in p));
      assert.equal(JSON.stringify(p), JSON.stringify(base));
    }
  }
});
