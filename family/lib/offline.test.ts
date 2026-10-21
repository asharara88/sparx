import test from "node:test";
import assert from "node:assert/strict";

// A localStorage stand-in so the queue helpers run under node's test runner.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

const { isTransient, mergeOngoing, newClientId, enqueue, readQueue, QUEUED_ID_PREFIX } = await import("./offline.ts");

test("newClientId is always a uuid, with or without crypto.randomUUID", () => {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(newClientId(), re);
  const c = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try {
    assert.match(newClientId(), re);
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: c, configurable: true });
  }
});

test("isTransient keeps network trouble for later and refuses real errors", () => {
  assert.equal(isTransient({ message: "TypeError: Failed to fetch" }), true);
  assert.equal(isTransient({ message: "Load failed" }), true);
  assert.equal(isTransient({ code: "", message: "<html>502 Bad Gateway</html>" }), true);
  assert.equal(isTransient({ code: "PGRST301", message: "JWT expired" }), true);
  assert.equal(isTransient({ code: "57014", message: "canceling statement due to statement timeout" }), true);
  assert.equal(isTransient({ code: "42501", message: "permission denied" }), false);
  assert.equal(isTransient({ code: "P0001", message: "bad type" }), false);
  assert.equal(isTransient({ code: "22P02", message: "invalid input syntax for type uuid" }), false);
  assert.equal(isTransient(null), false);
});

test("mergeOngoing shows a queued start as running and hides a server timer with a queued end", () => {
  store.clear();
  const sleep = { id: "srv-1", type_id: "lana.sleep", occurred_at: "2026-10-21T01:00:00.000Z", payload: {}, by: "Dana" };
  const feed = { id: "srv-2", type_id: "lana.feed", occurred_at: "2026-10-21T01:30:00.000Z", payload: { method: "Breast" }, by: "Dana" };
  enqueue({ op: "end", client_id: "e1", entry_id: "srv-1", start_client_id: null, ended_at: "2026-10-21T02:00:00.000Z", queued_at: "x" });
  enqueue({ op: "log", client_id: "s1", subject_id: "lana", type_id: "lana.sleep", occurred_at: "2026-10-21T02:10:00.000Z", ended_at: null, payload: {}, note: null, queued_at: "x" });
  enqueue({ op: "log", client_id: "d1", subject_id: "lana", type_id: "lana.diaper", occurred_at: "2026-10-21T02:11:00.000Z", ended_at: "2026-10-21T02:11:00.000Z", payload: {}, note: null, queued_at: "x" });
  enqueue({ op: "log", client_id: "other", subject_id: "fanta", type_id: "fanta.food", occurred_at: "2026-10-21T02:12:00.000Z", ended_at: null, payload: {}, note: null, queued_at: "x" });
  const merged = mergeOngoing([sleep, feed], "lana", readQueue(), "Wafa");
  assert.deepEqual(
    merged.map((e) => e.id),
    ["srv-2", QUEUED_ID_PREFIX + "s1"],
  );
  assert.equal(merged[1].by, "Wafa");
});

test("mergeOngoing applies the type's timer rule: a queued bottle is not feeding, a queued breastfeed is", () => {
  store.clear();
  const types = [
    { id: "lana.feed", has_end: true, settings: { end_if: { method: "Breast" } } },
    { id: "lana.sleep", has_end: true, settings: {} },
    { id: "lana.diaper", has_end: false, settings: {} },
  ];
  enqueue({ op: "log", client_id: "b1", subject_id: "lana", type_id: "lana.feed", occurred_at: "2026-10-21T02:00:00.000Z", ended_at: null, payload: { method: "Bottle", amount_ml: 90 }, note: null, queued_at: "x" });
  enqueue({ op: "log", client_id: "f1", subject_id: "lana", type_id: "lana.feed", occurred_at: "2026-10-21T02:05:00.000Z", ended_at: null, payload: { method: "Breast", side: "Left" }, note: null, queued_at: "x" });
  enqueue({ op: "log", client_id: "d1", subject_id: "lana", type_id: "lana.diaper", occurred_at: "2026-10-21T02:06:00.000Z", ended_at: null, payload: { kind: "Wet" }, note: null, queued_at: "x" });
  const merged = mergeOngoing([], "lana", readQueue(), null, types);
  assert.deepEqual(
    merged.map((e) => e.id),
    [QUEUED_ID_PREFIX + "f1"],
  );
});

test("readQueue filters by owner but keeps entries queued before owners existed", () => {
  store.clear();
  enqueue({ op: "log", client_id: "a", subject_id: "s", type_id: "t", occurred_at: "x", ended_at: null, payload: {}, note: null, queued_at: "x", owner: "user-1" });
  enqueue({ op: "log", client_id: "b", subject_id: "s", type_id: "t", occurred_at: "x", ended_at: null, payload: {}, note: null, queued_at: "x", owner: "user-2" });
  enqueue({ op: "log", client_id: "c", subject_id: "s", type_id: "t", occurred_at: "x", ended_at: null, payload: {}, note: null, queued_at: "x" });
  assert.deepEqual(readQueue("user-1").map((e) => e.client_id), ["a", "c"]);
  assert.deepEqual(readQueue().map((e) => e.client_id), ["a", "b", "c"]);
});
