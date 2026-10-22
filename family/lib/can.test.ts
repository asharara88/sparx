import { test } from "node:test";
import assert from "node:assert/strict";
import { can, type Me } from "./types.ts";

const me = {
  ok: true,
  permissions: { notes: { view: true, add: true }, lana: { view: true } },
  household: { name: "Home", timezone: "Asia/Dubai", currency: "AED", hidden_modules: ["notes"] },
} as unknown as Me;

test("can(): a hidden module is off for everyone, even with the permission", () => {
  assert.equal(can(me, "lana", "view"), true);
  assert.equal(can(me, "notes", "view"), false);
  assert.equal(can(me, "notes", "add"), false);
  assert.equal(can({ ...me, household: { ...me.household, hidden_modules: [] } } as Me, "notes", "view"), true);
  assert.equal(can(null, "lana", "view"), false);
});
