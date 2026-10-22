import test from "node:test";
import assert from "node:assert/strict";

// A localStorage stand-in so the queue helpers run under node's test runner.
const store = new Map<string, string>();
let storageBroken = false; // a full or blocked localStorage throws on every write
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (storageBroken) throw new Error("QuotaExceededError");
    store.set(k, v);
  },
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

const { isTransient, mergeOngoing, newClientId, enqueue, readQueue, QUEUED_ID_PREFIX, sendOrQueue, endOrQueue, flushQueue, setQueueHome } = await import("./offline.ts");

type Call = { fn: string; args: Record<string, unknown>; headers: Record<string, string> };
/** A Supabase client stand-in: signed in as `owner`, answering each RPC through `answer`. */
function fakeSupabase(owner: string, answer: (fn: string, args: Record<string, unknown>) => unknown) {
  const calls: Call[] = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: owner } } } }) },
    // Like a PostgREST request builder: headers can be set on it, and awaiting it sends.
    rpc: (fn: string, args: Record<string, unknown>) => {
      const call: Call = { fn, args, headers: {} };
      const req = {
        setHeader(name: string, value: string) {
          call.headers[name] = value;
          return req;
        },
        then(resolve: (v: { data: unknown; error: null }) => void, reject: (e: unknown) => void) {
          calls.push(call);
          Promise.resolve()
            .then(async () => ({ data: await answer(fn, args), error: null }))
            .then(resolve, reject);
        },
      };
      return req;
    },
  };
  return { client: client as unknown as Parameters<typeof flushQueue>[0], calls };
}
const start = (client_id: string, owner: string) => ({ op: "log" as const, client_id, subject_id: "s", type_id: "lana.sleep", occurred_at: "2026-10-14T10:00:00.000Z", ended_at: null, payload: {}, note: null, queued_at: "2026-10-14T10:00:00.000Z", owner });

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
  enqueue({ op: "log", client_id: "other", subject_id: "other", type_id: "other.note", occurred_at: "2026-10-21T02:12:00.000Z", ended_at: null, payload: {}, note: null, queued_at: "x" });
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

test("a wake-up tapped while the queued sleep start is uploading is not lost", async () => {
  store.clear();
  enqueue(start("sleep-1", "user-1"));
  const woke = "2026-10-14T11:00:00.000Z";
  let tapped = false;
  const { client, calls } = fakeSupabase("user-1", (fn) => {
    if (fn === "care_entry_log") {
      // The carer taps "woke up" while this send is in flight: the end lands on the queued start.
      if (!tapped) {
        tapped = true;
        return endOrQueue(client, QUEUED_ID_PREFIX + "sleep-1", woke).then((r) => {
          assert.equal(r.status, "queued");
          return { ok: true, id: "srv-1" };
        });
      }
      return { ok: true, id: "srv-1" };
    }
    return { ok: true, id: "srv-1" };
  });
  const r = await flushQueue(client);
  assert.deepEqual(r, { sent: 2, failed: 0 });
  assert.deepEqual(calls.map((c) => c.fn), ["care_entry_log", "care_entry_end"]);
  assert.equal(calls[1].args.p_id, "srv-1");
  assert.equal(calls[1].args.p_ended_at, woke);
  assert.deepEqual(readQueue(), []);
});

test("an end that was already on the queued start before the upload still goes with it", async () => {
  store.clear();
  enqueue({ ...start("sleep-2", "user-1"), ended_at: "2026-10-14T11:00:00.000Z" });
  const { client, calls } = fakeSupabase("user-1", () => ({ ok: true, id: "srv-2" }));
  await flushQueue(client);
  assert.deepEqual(calls.map((c) => c.fn), ["care_entry_log"]);
  assert.equal(calls[0].args.p_ended_at, "2026-10-14T11:00:00.000Z");
  assert.deepEqual(readQueue(), []);
});

test("a queued entry is replayed into the home it was made in, whatever the phone shows now", async () => {
  store.clear();
  // Two entries kept while the phone showed home A, one while it showed home B, and one from before homes were stamped.
  enqueue({ ...start("a1", "user-1"), home: "home-a" });
  enqueue({ ...start("b1", "user-1"), home: "home-b" });
  enqueue({ ...start("old", "user-1") });
  const { client, calls } = fakeSupabase("user-1", () => ({ ok: true, id: "srv" }));
  const r = await flushQueue(client);
  assert.deepEqual(r, { sent: 3, failed: 0 });
  assert.deepEqual(
    calls.map((c) => [c.args.p_client_id, c.headers["x-home"]]),
    [
      ["a1", "home-a"],
      ["b1", "home-b"],
      ["old", undefined],
    ],
    "each request names the home its entry was made in; one from before homes were stamped names none",
  );
  assert.deepEqual(readQueue(), []);
});

test("a new operation is stamped with the home the page shows", async () => {
  store.clear();
  setQueueHome("home-c");
  try {
    const { client } = fakeSupabase("user-1", () => ({ ok: true, id: "x" }));
    // navigator.onLine is undefined under node, which the queue reads as offline: the entry is kept.
    const r = await sendOrQueue(client, { client_id: "c1", subject_id: "s", type_id: "lana.feed", occurred_at: "2026-10-14T10:00:00.000Z", ended_at: null, payload: {}, note: null });
    assert.equal(r.status, "queued");
    assert.equal(readQueue()[0].home, "home-c");
    const e = await endOrQueue(client, "srv-1", "2026-10-14T11:00:00.000Z");
    assert.equal(e.status, "queued");
    assert.equal(readQueue()[1].home, "home-c");
  } finally {
    setQueueHome(null);
  }
});

test("when this phone cannot keep an entry, the carer is told, not shown 'saved'", async () => {
  store.clear();
  const { client, calls } = fakeSupabase("user-1", () => ({ ok: true, id: "x" }));
  // In node `navigator.onLine` is undefined, which the queue reads as offline: nothing is sent.
  storageBroken = true;
  try {
    const r = await sendOrQueue(client, { client_id: "c1", subject_id: "s", type_id: "lana.feed", occurred_at: "2026-10-14T10:00:00.000Z", ended_at: null, payload: {}, note: null });
    assert.equal(r.status, "error");
    assert.match((r as { message: string }).message, /could not keep/);
    const e = await endOrQueue(client, "srv-9", "2026-10-14T11:00:00.000Z");
    assert.equal(e.status, "error");
  } finally {
    storageBroken = false;
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(readQueue(), []);
  const ok = await sendOrQueue(client, { client_id: "c2", subject_id: "s", type_id: "lana.feed", occurred_at: "2026-10-14T10:00:00.000Z", ended_at: null, payload: {}, note: null });
  assert.equal(ok.status, "queued");
  assert.equal(readQueue().length, 1);
});
