import { test } from "node:test";
import assert from "node:assert/strict";

const NOW = "2026-11-09T15:00";
const V = { name: "Lana", diaperKinds: ["Wet", "Dirty", "Both"], milks: ["Morning pumped", "Night pumped", "Freezer", "Formula"] };

test("readQuick: bottles in ml, with formula named, and when", async () => {
  const { readQuick } = await import("./quick-log.ts");
  assert.deepEqual(readQuick("120 ml bottle", NOW, V), { kind: "bottle", amount_ml: 120, milk: null, when: { agoMin: 0 } });
  assert.deepEqual(readQuick("Fed her a bottle of 120ml formula", NOW, V), { kind: "bottle", amount_ml: 120, milk: "Formula", when: { agoMin: 0 } });
  assert.deepEqual(readQuick("Lana drank 90 ml 20 min ago", NOW, V), { kind: "bottle", amount_ml: 90, milk: null, when: { agoMin: 20 } });
  assert.deepEqual(readQuick("Log a 120 ml bottle now", NOW, V), { kind: "bottle", amount_ml: 120, milk: null, when: { agoMin: 0 } });
  assert.deepEqual(readQuick("150 ml at 1330", NOW, V), { kind: "bottle", amount_ml: 150, milk: null, when: { local: "2026-11-09T13:30" } });
  assert.equal(readQuick("pumped 120 ml", NOW, V), null, "a pump is not a feed");
  assert.equal(readQuick("120 ml from the freezer", NOW, V), null, "more than this reader knows goes to the helper");
  assert.equal(readQuick("5 ml", NOW, V), null);
});

test("readQuick: nappies, with the kind asked when not said", async () => {
  const { readQuick } = await import("./quick-log.ts");
  assert.deepEqual(readQuick("wet nappy", NOW, V), { kind: "diaper", diaper: "Wet", when: { agoMin: 0 } });
  assert.deepEqual(readQuick("dirty diaper 10 mins ago", NOW, V), { kind: "diaper", diaper: "Dirty", when: { agoMin: 10 } });
  assert.deepEqual(readQuick("wet and dirty nappy", NOW, V), { kind: "diaper", diaper: "Both", when: { agoMin: 0 } });
  assert.deepEqual(readQuick("she did a poo", NOW, V), { kind: "diaper", diaper: "Dirty", when: { agoMin: 0 } });
  assert.deepEqual(readQuick("just changed a nappy", NOW, V), { kind: "diaper", diaper: null, when: { agoMin: 0 } });
  assert.equal(readQuick("wet nappy and 120 ml", NOW, V), null, "two things at once go to the helper");
});

test("readQuick: asleep, awake, and a finished sleep", async () => {
  const { readQuick } = await import("./quick-log.ts");
  assert.deepEqual(readQuick("She fell asleep 10 min ago", NOW, V), { kind: "sleep_start", when: { agoMin: 10 } });
  assert.deepEqual(readQuick("went down for a nap", NOW, V), { kind: "sleep_start", when: { agoMin: 0 } });
  assert.deepEqual(readQuick("woke up at 6:40", NOW, V), { kind: "wake", when: { local: "2026-11-09T06:40" } });
  assert.deepEqual(readQuick("she's awake", NOW, V), { kind: "wake", when: { agoMin: 0 } });
  assert.deepEqual(readQuick("woke up half an hour ago", NOW, V), { kind: "wake", when: { agoMin: 30 } });
  assert.deepEqual(readQuick("slept 1 to 2:15", NOW, V), { kind: "sleep", from: "2026-11-09T13:00", to: "2026-11-09T14:15" });
  assert.deepEqual(readQuick("napped from 11:30 till 12:10", NOW, V), { kind: "sleep", from: "2026-11-09T11:30", to: "2026-11-09T12:10" });
  assert.equal(readQuick("napped 19 min ago", NOW, V), null, "fell asleep or woke? the helper asks");
  assert.equal(readQuick("slept badly", NOW, V), null);
});

test("readQuick: anything else is the helper's", async () => {
  const { readQuick } = await import("./quick-log.ts");
  for (const s of ["When did she last feed?", "How did she sleep last night?", "remember that she likes the blue blanket", "log a breastfeed on the left", "fell asleep 10 min ago and woke now"]) assert.equal(readQuick(s, NOW, V), null, s);
});

test("resolveBare: the most recent meaning of a clock said in words", async () => {
  const { resolveBare } = await import("./quick-log.ts");
  assert.equal(resolveBare("6:40", NOW), "2026-11-09T06:40");
  assert.equal(resolveBare("1", NOW), "2026-11-09T13:00");
  assert.equal(resolveBare("11", "2026-11-09T09:00"), "2026-11-08T23:00");
  assert.equal(resolveBare("9 am", NOW), "2026-11-09T09:00");
  assert.equal(resolveBare("0130", NOW), "2026-11-09T01:30");
});

test("readDiaperAnswer: the tap on Wet, Dirty or Both", async () => {
  const { readDiaperAnswer } = await import("./quick-log.ts");
  assert.equal(readDiaperAnswer("Wet", V.diaperKinds), "Wet");
  assert.equal(readDiaperAnswer("both.", V.diaperKinds), "Both");
  assert.equal(readDiaperAnswer("poo", V.diaperKinds), "Dirty");
  assert.equal(readDiaperAnswer("what?", V.diaperKinds), null);
});
