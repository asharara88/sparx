import { test } from "node:test";
import assert from "node:assert/strict";
import { windowStats } from "./handover.ts";
import type { EntryRow } from "./types.ts";

const row = (type_id: string, occurred_at: string, ended_at: string | null = null, payload: Record<string, unknown> = {}): EntryRow =>
  ({ id: occurred_at, type_id, occurred_at, ended_at, payload, note: null, subject_id: "s" }) as unknown as EntryRow;

// Mama leaves at 08:00 and is back at 17:00.
const from = "2026-10-14T04:00:00.000Z";
const to = "2026-10-14T13:00:00.000Z";

test("a nap she left during counts from when she left; one still running counts up to now", () => {
  const s = windowStats(
    [
      row("lana.sleep", "2026-10-14T03:30:00.000Z", "2026-10-14T04:45:00.000Z"), // 07:30 to 08:45: 45 min inside
      row("lana.sleep", "2026-10-14T08:00:00.000Z", "2026-10-14T09:00:00.000Z"), // 12:00 to 13:00: 60 min
      row("lana.sleep", "2026-10-14T12:30:00.000Z", null), // 16:30, still asleep: 30 min up to 17:00
      row("lana.sleep", "2026-10-13T20:00:00.000Z", "2026-10-13T23:00:00.000Z"), // last night: not in the window
    ],
    from,
    to,
  );
  assert.equal(s.naps, 3);
  assert.equal(s.napMin, 135);
});

test("a nap that runs past the end of the window is capped at the end", () => {
  const s = windowStats([row("lana.sleep", "2026-10-14T12:00:00.000Z", "2026-10-14T14:00:00.000Z")], from, to);
  assert.equal(s.naps, 1);
  assert.equal(s.napMin, 60);
});

test("feeds and nappies count by when they happened", () => {
  const s = windowStats(
    [
      row("lana.feed", "2026-10-14T05:00:00.000Z", null, { method: "Bottle", amount_ml: 120 }),
      row("lana.feed", "2026-10-14T09:00:00.000Z", null, { method: "Bottle", amount_ml: 150 }),
      row("lana.feed", "2026-10-14T03:00:00.000Z", null, { method: "Breast" }), // before she left
      row("lana.feed", "2026-10-14T06:00:00.000Z", null, { method: "Breast" }),
      row("lana.diaper", "2026-10-14T07:00:00.000Z"),
      row("lana.diaper", "2026-10-14T13:30:00.000Z"), // after she was back
    ],
    from,
    to,
  );
  assert.deepEqual(s, { bottles: 2, ml: 270, breast: 1, diapers: 1, naps: 0, napMin: 0 });
});
