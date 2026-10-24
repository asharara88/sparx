import { test } from "node:test";
import assert from "node:assert/strict";
import { credentialFrom, csrfMatches, googleButtonWidth } from "./google.ts";

test("Google's button is between 200 and 400 pixels wide, whatever the card measures", () => {
  assert.equal(googleButtonWidth(342), 342);
  assert.equal(googleButtonWidth(150), 200);
  assert.equal(googleButtonWidth(900), 400);
  assert.equal(googleButtonWidth(0), 320);
  assert.equal(googleButtonWidth(NaN), 320);
});

test("the double-submit check needs the cookie and the field to agree", () => {
  assert.equal(csrfMatches("abc", "abc"), true);
  assert.equal(csrfMatches("abc", "abd"), false);
  assert.equal(csrfMatches(undefined, "abc"), false);
  assert.equal(csrfMatches("abc", null), false);
  assert.equal(csrfMatches("", ""), false);
});

test("only something shaped like an ID token is taken as one", () => {
  assert.equal(credentialFrom("eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"), "eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
  assert.equal(credentialFrom("not a token"), null);
  assert.equal(credentialFrom(null), null);
});
