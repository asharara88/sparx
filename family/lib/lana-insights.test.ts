import { test } from "node:test";
import assert from "node:assert/strict";
import { awakeWindow, growthSpurt, sleepCoach } from "./lana-insights.ts";
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
