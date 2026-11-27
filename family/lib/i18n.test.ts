import { test } from "node:test";
import assert from "node:assert/strict";
import { spokenWhen, t } from "./i18n.ts";

const now = new Date("2026-10-14T16:00:00Z"); // Wed 14 Oct 2026, 20:00 in Dubai

test("spokenWhen: today is the time alone, yesterday says so, further back carries the day", () => {
  assert.equal(spokenWhen("2026-10-14T15:50:00Z", "Asia/Dubai", "en", now), "19:50");
  assert.equal(spokenWhen("2026-10-13T15:50:00Z", "Asia/Dubai", "en", now), "yesterday 19:50");
  assert.equal(spokenWhen("2026-10-12T15:50:00Z", "Asia/Dubai", "en", now), "Monday 12 October 19:50");
  // Days are the household's, not UTC's: 23:30 in Dubai is still today at 23:50 there,
  // and already yesterday at 00:30 there, although both are the same UTC day.
  assert.equal(spokenWhen("2026-10-13T19:30:00Z", "Asia/Dubai", "en", new Date("2026-10-13T19:50:00Z")), "23:30");
  assert.equal(spokenWhen("2026-10-13T19:30:00Z", "Asia/Dubai", "en", new Date("2026-10-13T20:30:00Z")), "yesterday 23:30");
});

test("spokenWhen: yesterday is the previous calendar date in the zone, even across a daylight-saving change", () => {
  // London springs forward at 01:00 UTC on 29 March 2026, so that day is 23 hours long.
  // At 00:30 BST on 30 March, "24 hours ago" is still 28 March; the calendar says 29 March.
  const justAfterMidnight = new Date("2026-03-29T23:30:00Z");
  assert.equal(spokenWhen("2026-03-29T12:00:00Z", "Europe/London", "en", justAfterMidnight), "yesterday 13:00");
  assert.equal(spokenWhen("2026-03-28T12:00:00Z", "Europe/London", "en", justAfterMidnight), "Saturday 28 March 12:00");
});

test("spokenWhen: Arabic and Russian say yesterday in their own words", () => {
  assert.match(spokenWhen("2026-10-13T15:50:00Z", "Asia/Dubai", "ar", now), /^أمس /);
  assert.match(spokenWhen("2026-10-13T15:50:00Z", "Asia/Dubai", "ru", now), /^вчера 19:50$/);
  assert.match(spokenWhen("2026-10-12T15:50:00Z", "Asia/Dubai", "ru", now), /понедельник/i);
});

test("what the helper says after a tap exists in every language", () => {
  for (const k of ["saved", "savedOffline", "ended", "onCalendar", "onList", "sentForApproval", "planStarted", "forgotten", "remembered", "couldNotSave", "to"] as const) {
    assert.ok(t("ar", k) !== t("en", k), `${k} is translated to Arabic`);
    assert.ok(t("ru", k) !== t("en", k), `${k} is translated to Russian`);
  }
  assert.equal(t("ru", "ended"), "Завершено.");
});

test("a started plan is said to be where it is: the child's page, never Home", () => {
  // Mido, 27 November: the helper said Home, which has not shown a plan since October.
  assert.equal(t("en", "planStarted", { child: "Lana" }), "Plan started. Today's step is on Lana's page.");
  assert.match(t("ar", "planStarted", { child: "لانا" }), /صفحة لانا/);
  assert.match(t("ru", "planStarted", { child: "Лана" }), /на странице/);
  for (const l of ["en", "ar", "ru"] as const) assert.doesNotMatch(t(l, "planStarted", { child: "Lana" }), /Home|الرئيسية|главном/);
});
