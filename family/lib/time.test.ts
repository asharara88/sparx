import { test } from "node:test";
import assert from "node:assert/strict";
import { dateWords, fmtDate, fmtDateTime, fmtTime, ISO_IN_TEXT } from "./time.ts";

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

test("dateWords keeps Intl's order and drops its separators", () => {
  const d = new Date(at);
  assert.equal(dateWords(d, { weekday: "short", day: "numeric", timeZone: "UTC" }), "Wed 14");
  assert.equal(dateWords(d, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }), "14 Oct 19:50");
});

test("ISO_IN_TEXT takes the whole instant out of a sentence, fraction and offset included", () => {
  const s = "A feed was logged at 2026-10-21T05:15:24.591871+00:00, 45 min in. Next at 2026-10-21T09:00:00Z.";
  assert.equal(s.replace(ISO_IN_TEXT, (iso) => fmtTime(iso, "Asia/Dubai")), "A feed was logged at 09:15, 45 min in. Next at 13:00.");
});
