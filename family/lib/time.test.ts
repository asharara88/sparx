import { test } from "node:test";
import assert from "node:assert/strict";
import { dateWords, fmtDate, fmtDateTime, fmtTime, fmtWhen, fromLocalInput, ISO_IN_TEXT, parseHouseholdTime, toLocalInput } from "./time.ts";

const at = "2026-10-14T15:50:00Z"; // Wed 14 Oct 2026, 19:50 in Dubai

test("fmtDate carries no locale punctuation, so server and browser agree", () => {
  assert.equal(fmtDate(at, "Asia/Dubai"), "Wed 14 Oct");
  assert.equal(fmtDate(at, "Asia/Dubai", { weekday: "long", day: "numeric", month: "long" }), "Wednesday 14 October");
  assert.equal(fmtDate(at, "Asia/Dubai", { day: "numeric", month: "long", year: "numeric", weekday: undefined }), "14 October 2026");
  assert.equal(fmtDate(at, "Asia/Dubai", { weekday: "short" }), "Wed 14 Oct");
  assert.doesNotMatch(fmtDate(at, "Asia/Dubai"), /[,.]/);
});

test("fmtTime and fmtDateTime use the household zone", () => {
  assert.equal(fmtTime(at, "Asia/Dubai"), "19:50");
  assert.equal(fmtTime(at, "UTC"), "15:50");
  assert.equal(fmtDateTime(at, "Asia/Dubai"), "Wed 14 Oct 19:50");
});

test("fmtWhen names today and yesterday in the household's zone, then the date", () => {
  const now = new Date("2026-10-14T20:30:00Z"); // Thu 15 Oct, 00:30 in Dubai
  assert.equal(fmtWhen("2026-10-14T20:10:00Z", "Asia/Dubai", now), "today 00:10");
  assert.equal(fmtWhen(at, "Asia/Dubai", now), "yesterday 19:50");
  assert.equal(fmtWhen("2026-10-12T08:00:00Z", "Asia/Dubai", now), "Mon 12 Oct");
  // the same instant is still "today" in UTC
  assert.equal(fmtWhen(at, "UTC", now), "today 15:50");
});

test("dateWords keeps Intl's order and drops its separators", () => {
  const d = new Date(at);
  assert.equal(dateWords(d, { weekday: "short", day: "numeric", timeZone: "UTC" }), "Wed 14");
  assert.equal(dateWords(d, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }), "14 Oct 19:50");
});

test("ISO_IN_TEXT takes the whole instant out of a sentence, fraction and offset included", () => {
  const s = "A feed was logged at 2026-10-21T05:15:24.591871+00:00, 45 min in. Next at 2026-10-21T09:00:00Z.";
  assert.equal(s.replace(ISO_IN_TEXT, (iso) => fmtTime(iso, "Asia/Dubai")), "A feed was logged at 09:15, 45 min in. Next at 13:00.");
});

test("parseHouseholdTime reads the helper's formats and refuses the rest", () => {
  assert.equal(parseHouseholdTime("2026-10-14 19:50", "Asia/Dubai"), "2026-10-14T15:50:00.000Z");
  assert.equal(parseHouseholdTime("2026-10-14T19:50", "Asia/Dubai"), "2026-10-14T15:50:00.000Z");
  assert.equal(parseHouseholdTime("2026-10-14", "Asia/Dubai"), "2026-10-13T20:00:00.000Z");
  assert.equal(parseHouseholdTime("2026-10-14T15:50:00Z", "Asia/Dubai"), "2026-10-14T15:50:00.000Z");
  for (const bad of ["", "  ", "now", "half past three", "3pm", "2026-13-01 10:00", "yesterday 19:50", "19:50"]) {
    assert.equal(parseHouseholdTime(bad, "Asia/Dubai"), null, JSON.stringify(bad));
  }
});

test("a wall time on a daylight-saving changeover day lands where the clock said", () => {
  // New York springs forward on 8 March 2026 at 02:00 (EST → EDT).
  assert.equal(toLocalInput(fromLocalInput("2026-03-08T03:30", "America/New_York"), "America/New_York"), "2026-03-08T03:30");
  assert.equal(toLocalInput(fromLocalInput("2026-03-08T01:30", "America/New_York"), "America/New_York"), "2026-03-08T01:30");
  assert.equal(fromLocalInput("2026-03-08T03:30", "America/New_York"), "2026-03-08T07:30:00.000Z");
  // and it falls back on 1 November 2026: 01:30 happens twice; the later (standard-time) one is taken
  assert.equal(toLocalInput(fromLocalInput("2026-11-01T01:30", "America/New_York"), "America/New_York"), "2026-11-01T01:30");
  assert.equal(parseHouseholdTime("2026-03-08 03:30", "America/New_York"), "2026-03-08T07:30:00.000Z");
});

test("an impossible offset is refused, not thrown", () => {
  for (const bad of ["2026-10-14T15:50:00+24:00", "2026-10-14T15:50:00+99:99", "2026-10-14T15:50:00-25:00"]) {
    assert.equal(parseHouseholdTime(bad, "Asia/Dubai"), null, bad);
  }
  assert.equal(parseHouseholdTime("2026-10-14T15:50:00+04:00", "Asia/Dubai"), "2026-10-14T11:50:00.000Z");
});
