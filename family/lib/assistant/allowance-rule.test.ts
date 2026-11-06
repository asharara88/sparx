import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAllowance } from "./allowance-rule.ts";

const base = { home_calls: 0, member_calls: 0, home_limit: 40, member_limit: 20, total_calls: 0, platform: false };

test("under every limit the call goes ahead", () => {
  assert.deepEqual(decideAllowance(base, {}), { ok: true });
  assert.deepEqual(decideAllowance({ ...base, home_calls: 39, member_calls: 19 }, { dailyTotal: "500" }), { ok: true });
});

test("the home's limit, then the member's, refuse with a plain message", () => {
  const home = decideAllowance({ ...base, home_calls: 40 }, {});
  assert.equal(home.ok, false);
  assert.match((home as { message: string }).message, /40 things for this home today/);
  const member = decideAllowance({ ...base, member_calls: 20 }, {});
  assert.match((member as { message: string }).message, /asked the helper 20 times today/);
});

test("no limit is no limit: the platform home by default", () => {
  assert.deepEqual(decideAllowance({ ...base, home_limit: null, member_limit: null, home_calls: 900, member_calls: 900, platform: true }, {}), { ok: true });
});

test("the deployment switches: other homes off, and a total for all homes", () => {
  assert.equal(decideAllowance(base, { otherHomes: "off" }).ok, false);
  assert.deepEqual(decideAllowance({ ...base, platform: true }, { otherHomes: "off" }), { ok: true }, "the platform home keeps its helper");
  assert.equal(decideAllowance({ ...base, total_calls: 300 }, { dailyTotal: "300" }).ok, false);
  assert.equal(decideAllowance({ ...base, total_calls: 300, platform: true }, { dailyTotal: "300" }).ok, false, "the total covers the platform home too");
  assert.deepEqual(decideAllowance({ ...base, total_calls: 10_000 }, { dailyTotal: "" }), { ok: true }, "blank is no total");
  assert.deepEqual(decideAllowance({ ...base, total_calls: 10_000 }, { dailyTotal: "lots" }), { ok: true }, "not a number is no total");
});
