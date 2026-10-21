import { test } from "node:test";
import assert from "node:assert/strict";
import { isAbort, withTimeout } from "./wait.ts";

const never = () => new Promise<string>(() => {});
const later = <T,>(v: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(v), ms));

test("withTimeout: resolves when the work does, fails on its own after the deadline", async () => {
  assert.equal(await withTimeout(later("ok", 5), 100, "quick"), "ok");
  await assert.rejects(withTimeout(never(), 20, "slow"), /slow took too long/);
});

test("withTimeout: an aborted signal stops the wait at once, before the deadline", async () => {
  const ac = new AbortController();
  const p = withTimeout(never(), 10_000, "tool", ac.signal);
  setTimeout(() => ac.abort(), 5);
  const t0 = Date.now();
  await assert.rejects(p, (e: unknown) => isAbort(e));
  assert.ok(Date.now() - t0 < 1000, "did not wait for the deadline");
});

test("withTimeout: a signal already aborted rejects without starting to wait", async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(withTimeout(later("ok", 1), 100, "tool", ac.signal), (e: unknown) => isAbort(e));
});

test("isAbort knows the SDK's abort error and an aborted signal", () => {
  const sdk = Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" });
  assert.equal(isAbort(sdk), true);
  assert.equal(isAbort(new Error("boom")), false);
  const ac = new AbortController();
  ac.abort();
  assert.equal(isAbort(new Error("boom"), ac.signal), true);
});
