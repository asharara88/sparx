import { test } from "node:test";
import assert from "node:assert/strict";
import { afterSignIn, inviteToken, joinPath } from "./join.ts";

test("a token is a uuid or nothing", () => {
  assert.equal(inviteToken("8F1C2A3B-0000-4000-8000-000000000001"), "8f1c2a3b-0000-4000-8000-000000000001");
  assert.equal(inviteToken("../login"), null);
  assert.equal(inviteToken(""), null);
  assert.equal(inviteToken(undefined), null);
});

test("an e-mail link comes back to the join screen the device was on", () => {
  const t = "8f1c2a3b-0000-4000-8000-000000000001";
  assert.equal(afterSignIn("/", t), joinPath(t));
  assert.equal(afterSignIn("/", "junk"), "/");
  assert.equal(afterSignIn("/", null), "/");
  // A password reset keeps its own landing page.
  assert.equal(afterSignIn("/me/password?reset=1", t), "/me/password?reset=1");
});
