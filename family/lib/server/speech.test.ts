import { test } from "node:test";
import assert from "node:assert/strict";
import { SPEECH_MAX_CHARS, speechText } from "./speech.ts";

test("what is read aloud: no citation markers, one line, capped", () => {
  assert.equal(speechText("Lana fed at 06:30 [entry:abc-123].  She slept\n2 h."), "Lana fed at 06:30 . She slept 2 h.");
  assert.equal(speechText("   "), "");
  assert.equal(speechText(undefined), "");
  assert.equal(speechText("a".repeat(5000)).length, SPEECH_MAX_CHARS);
});
