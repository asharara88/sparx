import { test } from "node:test";
import assert from "node:assert/strict";
import { bottleAction, matchBottle, matchMedicine, matchMember, matchVaccines, mergeEntry, type Bottle, type VaccineItem } from "./write-match.ts";

const people = [
  { id: "m1", name: "Mido" },
  { id: "m2", name: "Dana" },
  { id: "m3", name: "Wafa" },
  { id: "m4", name: "Lilly" },
  { id: "m5", name: "Luda" },
];

test("matchMember: a name, a first name, the start of one, and me", () => {
  assert.deepEqual(matchMember(people, "Wafa"), { ok: true, item: { id: "m3", name: "Wafa" } });
  assert.deepEqual(matchMember(people, "wafa"), { ok: true, item: { id: "m3", name: "Wafa" } });
  assert.deepEqual(matchMember([...people, { id: "m6", name: "Sara Haddad" }], "sara"), { ok: true, item: { id: "m6", name: "Sara Haddad" } });
  assert.deepEqual(matchMember(people, "Lil"), { ok: true, item: { id: "m4", name: "Lilly" } });
  assert.deepEqual(matchMember(people, "me", "m2"), { ok: true, item: { id: "m2", name: "Dana" } });
});

test("matchMember: two who fit is a question, nobody is unknown", () => {
  const r = matchMember(people, "L");
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error, "ambiguous");
  assert.deepEqual(!r.ok && r.options.map((p) => p.name), ["Lilly", "Luda"]);
  const u = matchMember(people, "Grandpa");
  assert.equal(!u.ok && u.error, "unknown");
  assert.equal(matchMember(people, "").ok, false);
  // "me" without knowing who is asking is not a guess.
  assert.equal(matchMember(people, "me").ok, false);
});

test("matchMedicine: exact, part of the name, one on the list", () => {
  const meds = [
    { id: "a", name: "Calpol" },
    { id: "b", name: "Vitamin D drops" },
  ];
  assert.equal(matchMedicine(meds, "calpol").ok && "a", "a");
  const v = matchMedicine(meds, "vitamin d");
  assert.equal(v.ok && v.item.id, "b");
  assert.equal(matchMedicine(meds, "nurofen").ok, false);
  assert.equal(matchMedicine([meds[0]], "").ok, true);
  assert.equal(matchMedicine(meds, "").ok, false);
});

const day = (iso: string) => iso.slice(0, 10);
const bottles: Bottle[] = [
  { id: "b1aaaaaa-0000", amount_ml: 120, location: "fridge", pumped_at: "2026-11-12T08:00:00Z" },
  { id: "b2bbbbbb-0000", amount_ml: 150, location: "fridge", pumped_at: "2026-11-11T08:00:00Z" },
  { id: "b3cccccc-0000", amount_ml: 180, location: "freezer", pumped_at: "2026-11-03T08:00:00Z" },
  { id: "b4dddddd-0000", amount_ml: 180, location: "freezer", pumped_at: "2026-10-31T08:00:00Z" },
  { id: "b5eeeeee-0000", amount_ml: 90, location: "fridge", pumped_at: "2026-11-07T08:00:00Z", expired: true },
];

test("matchBottle: by amount, by place and day, by id; two that fit is a question", () => {
  assert.equal((matchBottle(bottles, { amount_ml: 120 }, day) as { item: Bottle }).item.id, "b1aaaaaa-0000");
  const two = matchBottle(bottles, { amount_ml: 180 }, day);
  assert.equal(!two.ok && two.error, "ambiguous");
  assert.equal(!two.ok && two.options.length, 2);
  assert.equal((matchBottle(bottles, { amount_ml: 180, pumped_on: "2026-10-31" }, day) as { item: Bottle }).item.id, "b4dddddd-0000");
  assert.equal((matchBottle(bottles, { location: "Freezer", pumped_on: "2026-11-03" }, day) as { item: Bottle }).item.id, "b3cccccc-0000");
  assert.equal((matchBottle(bottles, { id: "b2bbbbbb" }, day) as { item: Bottle }).item.id, "b2bbbbbb-0000");
  assert.equal((matchBottle(bottles, { expired: true }, day) as { item: Bottle }).item.id, "b5eeeeee-0000");
  const none = matchBottle(bottles, { amount_ml: 60 }, day);
  assert.equal(!none.ok && none.error, "unknown");
  assert.equal(!none.ok && none.options.length, 5);
});

test("bottleAction: the words people use", () => {
  assert.equal(bottleAction("thawed"), "fridge");
  assert.equal(bottleAction("Binned"), "binned");
  assert.equal(bottleAction("thrown away"), "binned");
  assert.equal(bottleAction("warmed"), "warmed");
  assert.equal(bottleAction("used"), "used");
  assert.equal(bottleAction("frozen"), null);
});

const book: VaccineItem[] = [
  { id: "s1", visit: "8 weeks", vaccine: "6-in-1", status: "given" },
  { id: "s2", visit: "8 weeks", vaccine: "Rotavirus", status: "given" },
  { id: "s3", visit: "4 months", vaccine: "Hexavalent (Infanrix Hexa)", dose: "2", status: "overdue" },
  { id: "s4", visit: "4 months", vaccine: "Pneumococcal (Prevenar 20)", dose: "2", status: "overdue" },
  { id: "s5", visit: "4 months", vaccine: "Rotavirus (Rotarix, oral)", dose: "2", status: "overdue" },
  { id: "s6", visit: "6 months", vaccine: "Hexavalent (Infanrix Hexa)", dose: "3", status: "upcoming" },
];

test("matchVaccines: a visit by any spelling, a vaccine by name, or the one due", () => {
  for (const said of ["4 months", "her 4 month jabs", "four months", "the 4m vaccines"]) {
    const r = matchVaccines(book, said);
    assert.equal(r.ok && r.visit, "4 months", said);
    assert.deepEqual(r.ok && r.items.map((v) => v.id), ["s3", "s4", "s5"], said);
  }
  const due = matchVaccines(book, "");
  assert.equal(due.ok && due.visit, "4 months");
  const rota = matchVaccines(book, "rotavirus");
  assert.deepEqual(rota.ok && rota.items.map((v) => v.id), ["s5"]);
  const done = matchVaccines(book, "8 weeks");
  assert.equal(!done.ok && done.error, "already_given");
  assert.equal(!matchVaccines(book, "yellow fever").ok, true);
  const allGiven = book.map((v) => ({ ...v, status: v.visit === "6 months" ? "upcoming" : "given" }));
  const nothing = matchVaccines(allGiven, "");
  assert.equal(!nothing.ok && nothing.error, "nothing_due");
});

const bottleEntry = { occurred_at: "2026-11-13T05:12:00Z", ended_at: null, payload: { method: "Bottle", amount_ml: 120, milk: "Formula" }, note: null };

test("mergeEntry: changes what was said, keeps the rest", () => {
  const r = mergeEntry(bottleEntry, { payload: { amount_ml: 90 } });
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.next, { occurred_at: "2026-11-13T05:12:00Z", ended_at: null, payload: { method: "Bottle", amount_ml: 90, milk: "Formula" }, note: null });
  assert.deepEqual(r.ok && r.changed, ["amount_ml"]);
});

test("mergeEntry: an end kept unless changed; cleared with an empty end; never before the start", () => {
  const sleep = { occurred_at: "2026-11-13T03:00:00Z", ended_at: "2026-11-13T04:00:00Z", payload: { place: "Cot", auto_end: true }, note: "Timer left on; end set to 12 h." };
  const later = mergeEntry(sleep, { occurred_at: "2026-11-13T02:40:00Z" });
  assert.equal(later.ok && later.next.ended_at, "2026-11-13T04:00:00Z");
  assert.deepEqual(later.ok && later.next.payload, { place: "Cot" }, "the limit's guess flag goes");
  const still = mergeEntry(sleep, { ended_at: "" });
  assert.equal(still.ok && still.next.ended_at, null);
  assert.deepEqual(still.ok && still.changed, ["end"]);
  const bad = mergeEntry(sleep, { ended_at: "2026-11-13T02:00:00Z" });
  assert.equal(!bad.ok && bad.error, "end_before_start");
});

test("mergeEntry: nothing different is not a change; null drops a field; a note can be set or cleared", () => {
  assert.equal(!mergeEntry(bottleEntry, { payload: { amount_ml: 120 } }).ok && "same", "same");
  const drop = mergeEntry(bottleEntry, { payload: { milk: null } });
  assert.deepEqual(drop.ok && drop.next.payload, { method: "Bottle", amount_ml: 120 });
  const note = mergeEntry(bottleEntry, { note: "  spat some up " });
  assert.equal(note.ok && note.next.note, "spat some up");
  const cleared = mergeEntry({ ...bottleEntry, note: "x" }, { note: "" });
  assert.equal(cleared.ok && cleared.next.note, null);
});

test("matchVaccines: a shared word is not a match (Hepatitis A is not Hepatitis B)", () => {
  const hep: VaccineItem[] = [
    { id: "hb", visit: "Birth", vaccine: "Hepatitis B", status: "due" },
    { id: "ha", visit: "18 months", vaccine: "Hepatitis A", status: "upcoming" },
  ];
  const a = matchVaccines(hep, "hepatitis a");
  assert.deepEqual(a.ok && a.items.map((v) => v.id), ["ha"]);
  const b = matchVaccines(hep, "Hep B");
  assert.equal(b.ok, false, "too short to be sure: asked, not guessed");
  assert.deepEqual((matchVaccines(hep, "hepatitis b") as { items: VaccineItem[] }).items.map((v) => v.id), ["hb"]);
});
