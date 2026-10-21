import { test } from "node:test";
import assert from "node:assert/strict";
import { windowStats } from "./handover.ts";
import type { EntryRow, HouseholdMember } from "./types.ts";

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

test("awayParent: the breastfeeding parent, else the parent with work hours, else nobody", async () => {
  const { awayParent } = await import("./handover.ts");
  const m = (name: string, extra: Partial<HouseholdMember> = {}): HouseholdMember =>
    ({ id: name, name, role_id: "family_carer", relationship: null, presence: null, works_today: true, work_days: [], ...extra }) as HouseholdMember;
  const noor = m("Noor", { role_id: "admin", relationship: "Parent", breastfeeds: true, work_days: [1, 2], work_from: "08:30", work_to: "17:30" });
  const haitham = m("Haitham", { role_id: "admin", relationship: "Parent", work_days: [0, 1, 2, 3, 4], work_from: "07:00", work_to: "16:00" });
  const maria = m("Maria", { role_id: "home_carer", relationship: "Household staff", work_days: [0, 2], work_from: "08:00", work_to: "18:00" });
  assert.equal(awayParent([haitham, noor, maria])?.name, "Noor", "the one marked breastfeeds wins");
  assert.equal(awayParent([maria, haitham])?.name, "Haitham", "no breastfeeds flag: the parent with work hours, not the staff");
  const nursingAtHome = m("Noor", { role_id: "admin", relationship: "Parent", breastfeeds: true, work_days: [] });
  assert.equal(awayParent([nursingAtHome, haitham, maria])?.name, "Haitham", "a nursing parent with no work days does not hide the parent who works");
  assert.equal(awayParent([nursingAtHome, maria]), null, "nursing at home and nobody else working: no away parent");
  const dad = m("Dad", { relationship: "Father", work_days: [1], work_from: "09:00", work_to: "17:00" });
  assert.equal(awayParent([maria, dad])?.name, "Dad", "a father by relationship counts as a parent");
  assert.equal(awayParent([maria, m("Teta", { relationship: "Haitham's mother" })]), null, "nobody with work hours, no away parent");
  assert.equal(awayParent([m("Mido", { role_id: "admin", work_days: [1] })]), null, "work days without hours are not enough");
});
