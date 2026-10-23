import { test } from "node:test";
import assert from "node:assert/strict";
import { callbackErrorCode, friendlyAuthError, loginErrorText } from "./auth-copy.ts";

test("Supabase's error strings come out as plain words", () => {
  assert.equal(friendlyAuthError("Invalid login credentials"), "Wrong e-mail or password.");
  assert.equal(friendlyAuthError("Email not confirmed"), "Confirm your e-mail first: open the message we sent, then sign in.");
  assert.equal(friendlyAuthError("Password should be at least 8 characters"), "Use at least 8 characters.");
  // Google before the provider is on in Supabase.
  assert.equal(friendlyAuthError("Unsupported provider: provider is not enabled"), "Google sign-in is not switched on yet. Sign in with your e-mail for now.");
  // Anything else is shown as it came.
  assert.equal(friendlyAuthError("Something odd"), "Something odd");
});

test("the sign-in screen names what went wrong", () => {
  assert.match(loginErrorText("link"), /link did not work/);
  assert.match(loginErrorText("google"), /Google sign-in did not finish/);
  assert.equal(loginErrorText("Any other text"), "Any other text");
});

test("a refused Google sign-in is told apart from an old e-mail link", () => {
  const params = (q: string) => new URLSearchParams(q);
  assert.equal(callbackErrorCode(params("error=access_denied&error_code=provider_refused&error_description=x")), "google");
  assert.equal(callbackErrorCode(params("error_code=unexpected_failure")), "google");
  // An expired e-mail link is still an old link, not Google.
  assert.equal(callbackErrorCode(params("error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")), "link");
  assert.equal(callbackErrorCode(params("code=abc")), null);
  assert.equal(callbackErrorCode(params("")), null);
});
