// Sets up a household from a config file: the household row, its members, the child,
// and (with --accounts) a sign-in account per member with an e-mail.
// Run from your machine against the household's own Supabase project, never from the
// browser. Idempotent: run it again after editing the file and it updates what changed.
//
//   cp household.example.json household.json      # then fill it in
//   npm run setup:household -- household.json --accounts
//
// The whole file is checked, and the plan for every member worked out, before the
// first write (lib/setup/plan.mjs, which the unit tests cover). Members match by
// `id` (printed by every run; put it in the file to make a member's row stable), else
// by e-mail, else by name. A member linked to a sign-in account keeps that link: a
// changed e-mail is refused unless the member says "relink": true. A deactivated
// member comes back only with "active": true; "active": false deactivates. Members in
// the home but not in the file are listed and left alone, unless
// household.deactivate_missing is true.
//
// Reads .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { blankToNull, linkOutcome, planMembers, validateConfig } from "../lib/setup/plan.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--")) ?? "household.json";
const withAccounts = args.includes("--accounts");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const cfg = JSON.parse(await readFile(file, "utf8"));
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
const ok = async (p) => {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
};

// ---- 1. Check the file, before anything is looked up or written ----------------
const problems = validateConfig(cfg);
if (problems.length) fail(problems.map((p) => `✗ ${p}`).join("\n"));

// ---- 2. Which home -----------------------------------------------------------
// One deployment holds many homes (docs/MULTI_HOME.md). This file is one home: the
// one with its `household.id`, else the one with its name, else the one nobody is
// in yet (a fresh deployment is seeded with one), else a new one.
const hh = cfg.household;
const given = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const homeRow = given({
  name: hh.name,
  timezone: blankToNull(hh.timezone) ?? "Asia/Dubai",
  currency: blankToNull(hh.currency) ?? "AED",
  notes: hh.notes ?? null,
  milk_target_ml: hh.milk_target_ml,
  bottle_interval_min: hh.bottle_interval_min,
  hidden_modules: hh.hidden_modules ?? ["shopping"],
});
const homes = await ok(admin.from("household").select("id, name"));
const peopled = new Set((await ok(admin.from("members").select("household_id"))).map((m) => m.household_id));
// Two homes may share a name; then the file must say which by id, or the script could
// write a family's members into a stranger's home.
const sameName = homes.filter((h) => h.name === hh.name);
if (!hh.id && sameName.length > 1) fail(`${sameName.length} homes are named "${hh.name}" (${sameName.map((h) => h.id).join(", ")}); set household.id to say which.`);
if (hh.id && !homes.some((h) => h.id === hh.id)) fail(`No home has id ${hh.id}.`);
const home = (hh.id && homes.find((h) => h.id === hh.id)) || sameName[0] || homes.find((h) => !peopled.has(h.id)) || null;

// ---- 3. The plan for the members, checked in full before the first write ---------
const existing = home ? await ok(admin.from("members").select("id, display_name, email, user_id, is_active").eq("household_id", home.id)) : [];
const plan = planMembers(cfg, existing, home?.id ?? null);
for (const w of plan.warnings) console.log(`! ${w}`);
if (plan.errors.length) fail(plan.errors.map((e) => `✗ ${e}`).join("\n") + "\nNothing was written.");

// ---- 4. Write: the home ------------------------------------------------------
const homeId = home
  ? (await ok(admin.from("household").update(homeRow).eq("id", home.id).select("id").single())).id
  : (await ok(admin.from("household").insert(homeRow).select("id").single())).id;
console.log(`✓ household "${hh.name}" (${homeRow.timezone}) ${home ? "updated" : "created"}, id ${homeId}`);

// ---- 5. Write: the members, as planned ---------------------------------------
const members = [];
for (let i = 0; i < plan.members.length; i++) {
  const p = plan.members[i];
  const m = cfg.members[i];
  const row = { ...p.row, household_id: homeId };
  const saved = p.found
    ? await ok(admin.from("members").update(row).eq("id", p.found.id).select("id, display_name, email, user_id, is_active").single())
    : await ok(admin.from("members").insert(row).select("id, display_name, email, user_id, is_active").single());
  members.push({ ...saved, cfg: m });
  // Work days: replace the set. Presence: set once, the app changes it afterwards.
  await ok(admin.from("work_schedules").delete().eq("member_id", saved.id));
  if (Array.isArray(m.work_days) && m.work_days.length) {
    await ok(admin.from("work_schedules").insert(m.work_days.map((d) => ({ household_id: homeId, member_id: saved.id, weekday: d }))));
  }
  const presence = await ok(admin.from("presence").select("id").eq("member_id", saved.id).limit(1));
  if (!presence.length) await ok(admin.from("presence").insert({ household_id: homeId, member_id: saved.id, state_id: m.presence ?? "lives_here" }));
  console.log(`✓ ${m.name} (${m.role})${row.email ? ` <${row.email}>` : ""} ${p.found ? "updated" : "added"}${p.note ? `, ${p.note}` : ""}  id ${saved.id}`);
}
for (const x of plan.missing) {
  if (x.action !== "deactivate") continue;
  await ok(admin.from("members").update({ is_active: false }).eq("id", x.id));
  console.log(`✓ ${x.display_name}: not in the file, deactivated (household.deactivate_missing)`);
}

// ---- 6. Write: the child -------------------------------------------------------
async function subject(kind, moduleId, s, sort) {
  if (!s || !s.name) return null;
  const { name, names = {}, ...rest } = s;
  const birth_date = blankToNull(rest.birth_date);
  const night_from = blankToNull(rest.night_from);
  const night_to = blankToNull(rest.night_to);
  delete rest.birth_date;
  delete rest.night_from;
  delete rest.night_to;
  const found = await ok(admin.from("care_subjects").select("id, profile, settings").eq("household_id", homeId).eq("kind", kind).eq("is_active", true).order("sort").limit(1));
  const row = {
    household_id: homeId,
    module_id: moduleId,
    kind,
    name,
    birth_date,
    profile: { ...(found[0]?.profile ?? {}), ...rest, names },
    settings: { ...(found[0]?.settings ?? {}), ...(night_from ? { night_from } : {}), ...(night_to ? { night_to } : {}) },
    sort,
  };
  const saved = found[0]
    ? await ok(admin.from("care_subjects").update(row).eq("id", found[0].id).select("id").single())
    : await ok(admin.from("care_subjects").insert(row).select("id").single());
  console.log(`✓ ${kind}: ${name}${birth_date ? `, born ${birth_date}` : ""}${found[0] ? " updated" : ""}`);
  return saved.id;
}
const childId = await subject("child", "lana", { emergency_ambulance: "998", ...cfg.child }, 10);

// Starting medicines for the child, only when the list is empty.
const meds = await ok(admin.from("medicines").select("id").eq("subject_id", childId).limit(1));
if (!meds.length) {
  await ok(
    admin.from("medicines").insert([
      { household_id: homeId, subject_id: childId, name: "Vitamin D drops", dose: "1 drop (400 IU)", min_gap_hours: 20, note: "Once a day." },
      { household_id: homeId, subject_id: childId, name: "Paracetamol (infant)", dose: "As the doctor wrote", min_gap_hours: 6, note: "Only if the doctor said so. Never more than 4 doses in 24 hours." },
    ]),
  );
}

// ---- 7. Sign-in accounts ----------------------------------------------------------
if (withAccounts) {
  for (const m of members) {
    if (!m.email) {
      console.log(`- ${m.display_name}: no e-mail, no account (they can be added from the Members screen later)`);
      continue;
    }
    if (m.is_active === false) {
      console.log(`- ${m.display_name}: deactivated, no account made`);
      continue;
    }
    // The database trigger links a new auth user to the member row by e-mail.
    const { data: created, error } = await admin.auth.admin.createUser({ email: m.email, email_confirm: true });
    if (error && !/already|exists|registered/i.test(error.message)) throw new Error(error.message);
    let userId = created?.user?.id;
    if (!userId) {
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      userId = list?.users?.find((u) => u.email?.toLowerCase() === m.email)?.id;
    }
    // The trigger may have linked it already; read the row again and say what really happened.
    const fresh = await ok(admin.from("members").select("user_id").eq("id", m.id).single());
    const outcome = linkOutcome(fresh, userId);
    if (outcome.link) await ok(admin.from("members").update({ user_id: userId }).eq("id", m.id).is("user_id", null));
    console.log(`✓ ${m.display_name} <${m.email}> ${created?.user ? "account created" : "account already existed"}, ${outcome.text}`);
  }
  console.log("\nEach person signs in with their e-mail: \"Forgot password\" on the sign-in screen sets their first password.");
} else {
  console.log("\nNo accounts made (add --accounts). Anyone who creates an account with a listed e-mail is linked on first sign-in.");
}
