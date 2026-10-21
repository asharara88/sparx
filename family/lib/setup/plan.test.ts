import { test } from "node:test";
import assert from "node:assert/strict";
import { blankToNull, linkOutcome, planMembers, validateConfig } from "./plan.mjs";

const HOME = "00000000-0000-4000-8000-00000000b000";
const base = () => ({
  household: { name: "Our home" },
  child: { name: "Omar" },
  members: [
    { name: "Haitham", email: "haitham@example.com", role: "admin", relationship: "Parent" },
    { name: "Noor", email: "noor@example.com", role: "admin", relationship: "Parent", work_from: "08:30", work_to: "17:30" },
    { name: "Maria", role: "home_carer", work_days: [0, 2, 3] },
  ],
});
const existing = () => [
  { id: "00000000-0000-4000-8000-000000000001", display_name: "Haitham", email: "haitham@example.com", user_id: "u-haitham", is_active: true },
  { id: "00000000-0000-4000-8000-000000000002", display_name: "Noor", email: "noor@example.com", user_id: "u-noor", is_active: true },
  { id: "00000000-0000-4000-8000-000000000003", display_name: "Maria", email: null, user_id: null, is_active: true },
  { id: "00000000-0000-4000-8000-000000000004", display_name: "Old sitter", email: "sitter@example.com", user_id: "u-sitter", is_active: false },
];

test("validateConfig: the whole file is checked before anything is written", () => {
  assert.deepEqual(validateConfig(base()), []);
  const noAdmin = base();
  noAdmin.members = noAdmin.members.map((m) => ({ ...m, role: "family_carer" }));
  assert.ok(validateConfig(noAdmin).some((e) => e.includes("admin")));
  const deactivatedAdmin = base();
  deactivatedAdmin.members[0].active = false;
  deactivatedAdmin.members[1].role = "family_carer";
  assert.ok(validateConfig(deactivatedAdmin).some((e) => e.includes("admin")), "an admin marked active: false does not count");
  const twice = base();
  twice.members.push({ name: "Maria", role: "sitter" });
  assert.ok(validateConfig(twice).some((e) => e.includes("twice")));
  const badRole = base();
  badRole.members[2].role = "boss";
  assert.ok(validateConfig(badRole).some((e) => e.includes("role")));
  const noChild = base();
  delete noChild.child;
  assert.ok(validateConfig(noChild).some((e) => e.includes("child.name")));
});

test("validateConfig: every typed value the script writes is checked, so a bad date cannot fail after the members are written", () => {
  const bad = base() as Record<string, any>;
  bad.child.birth_date = "2026-02-30";
  bad.child.night_from = "7pm";
  bad.household.timezone = "Dubai";
  bad.household.bottle_interval_min = "180";
  bad.members[1].work_from = "8:30";
  bad.members[2].birth_date = "01/02/1990";
  bad.members[2].email = "maria at example";
  bad.members[2].work_days = [1, 1, 3];
  const errors = validateConfig(bad);
  for (const want of ["child: birth_date", "child: night_from", "household.timezone", "bottle_interval_min", "Noor: work_from", "Maria: birth_date", "not an e-mail", "Maria: work_days lists a day twice"]) {
    assert.ok(errors.some((e) => e.includes(want)), `${want} is refused: ${errors.join("; ")}`);
  }
  // Fields left blank in the file are simply not given.
  const blank = base() as Record<string, any>;
  blank.child.birth_date = "";
  blank.members[0].birth_date = "";
  blank.members[0].work_from = "";
  blank.members[0].email = "";
  assert.deepEqual(validateConfig(blank), []);
  const row = planMembers(blank, [], "00000000-0000-4000-8000-00000000b000").members[0].row;
  assert.equal(row.birth_date, null);
  assert.equal(row.work_from, null);
  assert.equal(row.email, null);
  assert.equal(blankToNull("  "), null);
  assert.equal(blankToNull("2026-10-01"), "2026-10-01");
});

test("planMembers: a changed e-mail on a linked member is refused, not quietly kept on the old account", () => {
  const cfg = base();
  cfg.members[1].email = "noor.new@example.com";
  const p = planMembers(cfg, existing(), HOME);
  assert.ok(p.errors.some((e) => e.includes("Noor") && e.includes("relink")), p.errors.join("; "));
  cfg.members[1].relink = true;
  const q = planMembers(cfg, existing(), HOME);
  assert.deepEqual(q.errors, []);
  const noor = q.members.find((m) => m.row.display_name === "Noor")!;
  assert.equal(noor.action, "update");
  assert.equal(noor.relink, true);
  assert.equal(noor.row.user_id, null, "the old link is dropped so the new account can be linked");
  assert.equal(noor.row.email, "noor.new@example.com");
});

test("planMembers: matching by id wins over e-mail and name; an unknown id stops the run", () => {
  const cfg = base();
  cfg.members[2] = { id: "00000000-0000-4000-8000-000000000003", name: "Maria Santos", role: "home_carer" };
  const p = planMembers(cfg, existing(), HOME);
  assert.deepEqual(p.errors, []);
  const maria = p.members[2];
  assert.equal(maria.action, "update");
  assert.equal(maria.found?.display_name, "Maria");
  assert.equal(maria.row.display_name, "Maria Santos", "renamed in place, same row");
  cfg.members[2].id = "00000000-0000-4000-8000-0000000000ff";
  assert.ok(planMembers(cfg, existing(), HOME).errors.some((e) => e.includes("no member in this home has id")));
});

test("planMembers: an e-mail that is another member's stops the run instead of rewriting that member", () => {
  // Noor's entry given Haitham's e-mail, no ids: the e-mail says Haitham, the name says Noor.
  const cfg = base();
  cfg.members[1].email = "haitham@example.com";
  const p = planMembers(cfg, existing(), HOME);
  assert.ok(p.errors.some((e) => e.includes("Noor") && e.includes("belongs to Haitham") && e.includes("matches Noor")), p.errors.join("; "));
  assert.ok(!p.members.some((m) => m.found?.display_name === "Haitham" && m.row.display_name === "Noor"), "Haitham's row is not planned as Noor");
  // The same with Noor's id given: the id names the row, and the e-mail is still refused.
  cfg.members[1].id = "00000000-0000-4000-8000-000000000002";
  const q = planMembers(cfg, existing(), HOME);
  assert.ok(q.errors.some((e) => e.includes("Noor") && e.includes("belongs to Haitham")), q.errors.join("; "));
  // A new member with a new e-mail and a new name is simply inserted.
  const fresh = base();
  fresh.members.push({ name: "Teta", email: "teta@example.com", role: "family_carer" });
  assert.deepEqual(planMembers(fresh, existing(), HOME).errors, []);
});

test("planMembers: a deactivated member comes back only with active: true; active: false deactivates", () => {
  const cfg = base();
  cfg.members.push({ name: "Old sitter", email: "sitter@example.com", role: "sitter" });
  const silent = planMembers(cfg, existing(), HOME);
  assert.ok(silent.errors.some((e) => e.includes("Old sitter") && e.includes("deactivated")), "listing them is not enough to bring them back");
  cfg.members[3].active = true;
  const back = planMembers(cfg, existing(), HOME);
  assert.deepEqual(back.errors, []);
  assert.equal(back.members[3].row.is_active, true);
  assert.match(back.members[3].note, /reactivated/);
  const cfg2 = base();
  cfg2.members[2].active = false;
  const off = planMembers(cfg2, existing(), HOME);
  assert.equal(off.members[2].row.is_active, false);
  assert.match(off.members[2].note, /deactivated/);
});

test("planMembers: members the file leaves out are reported and kept, or deactivated on request", () => {
  const cfg = base();
  cfg.members = cfg.members.slice(0, 2);
  const keep = planMembers(cfg, existing(), HOME);
  assert.deepEqual(keep.missing.map((m) => [m.display_name, m.action]), [["Maria", "keep"]], "the already deactivated sitter is not listed again");
  assert.ok(keep.warnings.some((w) => w.includes("Maria") && w.includes("left as is")));
  cfg.household.deactivate_missing = true;
  const off = planMembers(cfg, existing(), HOME);
  assert.deepEqual(off.missing.map((m) => [m.display_name, m.action]), [["Maria", "deactivate"]]);
});

test("planMembers: a new member is inserted active; two file entries cannot claim one row", () => {
  const cfg = base();
  cfg.members.push({ name: "Teta", role: "family_carer", lang: "ar" });
  const p = planMembers(cfg, existing(), HOME);
  assert.equal(p.members[3].action, "insert");
  assert.equal(p.members[3].row.is_active, true);
  const clash = base();
  clash.members.push({ name: "maria", role: "sitter" });
  assert.ok(planMembers(clash, existing(), HOME).errors.some((e) => e.includes("same row")));
});

test("linkOutcome says what really happened to the link", () => {
  assert.equal(linkOutcome({ user_id: null }, "u-1").link, true);
  assert.equal(linkOutcome({ user_id: "u-1" }, "u-1").text, "already linked to this account");
  const other = linkOutcome({ user_id: "u-old" }, "u-new");
  assert.equal(other.link, false);
  assert.match(other.text, /different account/);
  assert.equal(linkOutcome({ user_id: null }, undefined).link, false);
});
