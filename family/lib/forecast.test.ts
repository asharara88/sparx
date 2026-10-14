import { test } from "node:test";
import assert from "node:assert/strict";
import { feedFullness, forecast, median, nextFeedAt, shortFeedHint } from "./forecast.ts";
import type { EntryRow } from "./types.ts";

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 13, 10, 0); // 10:00 UTC
const iso = (ms: number) => new Date(ms).toISOString();
const row = (type_id: string, at: number, end: number | null = null): EntryRow => ({ id: `${type_id}-${at}`, type_id, type_label: type_id, icon: null, occurred_at: iso(at), ended_at: end == null ? null : iso(end), payload: {}, note: null });

test("median falls back below three samples and ignores outliers", () => {
  assert.equal(median([], 7), 7);
  assert.equal(median([1 * H, 2 * H], 7), 7);
  assert.equal(median([1 * H, 2 * H, 3 * H, 40 * H], 7), 2 * H);
});

test("feeds follow the learned gap from the last feed", () => {
  const feeds = [-9, -6.5, -4, -1.5].map((h) => row("lana.feed", NOW + h * H)); // 2.5 h apart
  const items = forecast(feeds, { now: NOW, hours: 6 });
  const f = items.filter((i) => i.kind === "feed");
  assert.equal(f[0].at, NOW + 1 * H); // last feed at -1.5 h + 2.5 h
  assert.equal(f[1].at, NOW + 3.5 * H);
  assert.equal(f[0].due, false);
});

test("a stale estimate rolls forward and shows as due", () => {
  const feeds = [-12, -9, -6].map((h) => row("lana.feed", NOW + h * H)); // 3 h apart, last 6 h ago
  const items = forecast(feeds, { now: NOW, hours: 4 });
  const f = items.filter((i) => i.kind === "feed");
  assert.equal(f[0].at, NOW); // -6 + 3 = -3 (stale), +3 = 0 → now
  assert.equal(f[0].due, true);
});

test("a shorter gap applies while Mama is away", () => {
  const feeds = [-8, -5, -2].map((h) => row("lana.feed", NOW + h * H)); // 3 h at home
  const items = forecast(feeds, { now: NOW, hours: 8, away: (at) => at >= NOW && at < NOW + 6 * H, feedIntervalMin: 180 });
  const f = items.filter((i) => i.kind === "feed");
  // The step is chosen by the time of the previous feed: at -2 h Mama was home (3 h), from +1 h she is away (2.5 h fallback, no samples).
  assert.deepEqual(f.map((i) => i.at), [NOW + 1 * H, NOW + 3.5 * H, NOW + 6 * H]);
});

test("asleep now: the wake comes before the next nap", () => {
  const sleeps = [row("lana.sleep", NOW - 6 * H, NOW - 4.5 * H), row("lana.sleep", NOW - 3 * H, NOW - 1.5 * H), row("lana.sleep", NOW - 0.5 * H, null)];
  const items = forecast(sleeps, { now: NOW, hours: 6 });
  const first = items.find((i) => i.kind === "wake" || i.kind === "sleep");
  assert.equal(first?.kind, "wake");
  assert.equal(first?.at, NOW + 1 * H); // 1.5 h nap from -0.5 h
});

test("nothing logged still gives a plan", () => {
  const items = forecast([], { now: NOW, hours: 12 });
  assert.ok(items.some((i) => i.kind === "feed"));
  assert.ok(items.some((i) => i.kind === "diaper"));
  assert.ok(items.every((i) => i.at >= NOW - 30 * 60_000 && i.at < NOW + 12 * H));
});

const feedRow = (at: number, payload: Record<string, unknown>, end: number | null = null): EntryRow => ({ ...row("lana.feed", at, end), payload });

test("feed fullness: side, minutes and bottle size", () => {
  assert.equal(feedFullness(feedRow(NOW, { method: "Breast", side: "Left" }, NOW + 10 * 60_000)), 0.33);
  assert.equal(feedFullness(feedRow(NOW, { method: "Breast", side: "Left", duration_min: 25 })), 0.75);
  assert.equal(feedFullness(feedRow(NOW, { method: "Breast", side: "Both", duration_min: 25 })), 1);
  const usual = [150, 150, 150].map((n, i) => feedRow(NOW - (i + 1) * H, { method: "Bottle", amount_ml: n }));
  assert.equal(feedFullness(feedRow(NOW, { method: "Bottle", amount_ml: 75 }), usual), 0.5);
  assert.equal(feedFullness(feedRow(NOW, { method: "Bottle", amount_ml: 40 })), 40 / 120);
});

test("next feed comes sooner after a small feed, never under an hour", () => {
  const full = nextFeedAt([feedRow(NOW - H, { method: "Breast", side: "Both", duration_min: 25 }, NOW - H + 25 * 60_000)], { gapMin: 180 })!;
  assert.equal(full.at, NOW - H + 25 * 60_000 + 3 * H);
  const sips = nextFeedAt([feedRow(NOW, { method: "Breast", side: "Left" }, NOW + 5 * 60_000)], { gapMin: 180 })!;
  assert.equal(sips.at, NOW + 5 * 60_000 + 1.5 * H);
  assert.equal(shortFeedHint(sips.last, sips.fullness), "Short feed on the left · she may want the right side soon");
  const capped = nextFeedAt([feedRow(NOW, { method: "Bottle", amount_ml: 120 })], { gapMin: 180, awayCapMin: 120, away: () => true })!;
  assert.equal(capped.at, NOW + 2 * H);
  assert.equal(nextFeedAt([], { gapMin: 180 }), null);
});
