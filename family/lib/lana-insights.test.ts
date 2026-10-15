import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOutlook, awakeWindow, daySchedule, growthSpurt, nextNap, sleepCoach } from "./lana-insights.ts";
import type { EntryRow } from "./types.ts";

const D = 86_400_000;
const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 13, 12, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const row = (type_id: string, at: number, end: number | null = null): EntryRow => ({ id: `${type_id}-${at}`, type_id, type_label: type_id, icon: null, occurred_at: iso(at), ended_at: end == null ? null : iso(end), payload: {}, note: null });
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const hourOf = (s: string) => new Date(s).getUTCHours() + new Date(s).getUTCMinutes() / 60;

test("awake window grows with age", () => {
  assert.deepEqual(awakeWindow(30), [45, 60]);
  assert.deepEqual(awakeWindow(130), [105, 150]);
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
  const c = sleepCoach(sleeps, 130, hourOf)!;
  assert.equal(c.napMin, 90);
  assert.equal(c.bestWindowMin, 120);
  assert.equal(c.bedtime, "19:30");
  assert.ok(c.naps >= 14);
  assert.equal(sleepCoach(sleeps.slice(0, 4), 130, hourOf), null);
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
  const s = daySchedule(7 * 60, 131, 110);
  assert.equal(s.awakeWindowMin, 110);
  assert.equal(s.basedOn, "her best recent window");
  assert.equal(s.lines[0].at, "07:00");
  assert.equal(s.lines[1].at, "08:50"); // first nap after 110 min
  const bed = s.lines[s.lines.length - 1];
  assert.equal(bed.what, "asleep for the night");
  assert.ok(bed.at >= "18:30" && bed.at <= "20:30");
  assert.equal(daySchedule(7 * 60, 131, null).basedOn, "age norm");
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
  const n = nextNap(rows, 130, NOW, hourOf)!;
  assert.equal(n.asleepSince, null);
  assert.equal(n.basis, "her rhythm");
  assert.equal(n.windowMin, 90);
  assert.equal(n.at, lastWake + 90 * 60_000);
  assert.equal(n.awakeMin, 30);
  assert.equal(n.isBedtime, false);
  // Asleep now: nothing to predict.
  const asleep = nextNap([...rows, row("lana.sleep", NOW - 10 * 60_000, null)], 130, NOW, hourOf)!;
  assert.equal(asleep.asleepSince, iso(NOW - 10 * 60_000));
  assert.equal(asleep.at, null);
  // No rhythm yet: the age norm, and a wake-up at 17:30 points to bedtime.
  const evening = Date.UTC(2026, 9, 13, 17, 30);
  const e = nextNap([row("lana.sleep", evening - H, evening)], 130, evening + 10 * 60_000, hourOf)!;
  assert.equal(e.basis, "her age");
  assert.equal(e.windowMin, 128);
  assert.equal(e.isBedtime, true);
  assert.equal(nextNap([], 130, NOW, hourOf), null);
});
