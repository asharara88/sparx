import { test } from "node:test";
import assert from "node:assert/strict";
import { allWell, missingFor, runJob } from "./jobs.ts";

const service = { SUPABASE_SERVICE_ROLE_KEY: "k" };
const pushes = {
  ...service,
  SUPABASE_JWT_SECRET: "s",
  VAPID_PUBLIC_KEY: "p",
  VAPID_PRIVATE_KEY: "q",
};

test("each job needs only its own keys: no push keys means no pushes, but the backup and the cleanups still run", () => {
  assert.deepEqual(missingFor("pushes", service), [
    "SUPABASE_JWT_SECRET",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
  ]);
  assert.deepEqual(missingFor("backup", service), []);
  assert.deepEqual(missingFor("cleanups", service), []);
  assert.deepEqual(missingFor("timers", service), []);
  assert.deepEqual(missingFor("backup", {}), ["SUPABASE_SERVICE_ROLE_KEY"]);
  assert.deepEqual(missingFor("pushes", pushes), []);
});

test("runJob: a job without its configuration is skipped and says what is missing, without running", async () => {
  let ran = false;
  const o = await runJob("pushes", service, async () => {
    ran = true;
    return { report: {} };
  });
  assert.equal(o.status, "not_configured");
  assert.deepEqual(o.missing, [
    "SUPABASE_JWT_SECRET",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
  ]);
  assert.equal(ran, false);
});

test("runJob: a job that throws is a failed job, not a thrown route", async () => {
  const o = await runJob("backup", service, async () => {
    throw new Error("bucket down");
  });
  assert.equal(o.status, "failed");
  assert.equal(o.error, "bucket down");
});

test("runJob: a job that returns is ok with its report", async () => {
  const o = await runJob("cleanups", service, async () => ({
    report: { pending: 2, done: 2, failed: 0 },
  }));
  assert.equal(o.status, "ok");
  assert.deepEqual(o.report, { pending: 2, done: 2, failed: 0 });
});

test("runJob: a job that comes back with an error of its own is failed, and keeps its report", async () => {
  const o = await runJob("cleanups", service, async () => ({
    report: { pending: 1, done: 1, failed: 1 },
    error: "1 cleanup failed",
  }));
  assert.equal(o.status, "failed");
  assert.equal(o.error, "1 cleanup failed");
  assert.deepEqual(o.report, { pending: 1, done: 1, failed: 1 });
});

test("allWell: one failed job marks the run; a job not configured does not", async () => {
  const ok = await runJob("backup", service, async () => ({ report: {} }));
  const skipped = await runJob("pushes", service, async () => ({ report: {} }));
  const failed = await runJob("cleanups", service, async () => {
    throw new Error("x");
  });
  assert.equal(allWell([ok, skipped]), true);
  assert.equal(allWell([ok, skipped, failed]), false);
});
