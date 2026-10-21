// Sets up a household from a config file: the household row, its members, the child,
// and (with --accounts) a sign-in account per member with an e-mail.
// Run from your machine against the household's own Supabase project, never from the
// browser. Idempotent: run it again after editing the file and it updates what changed
// (members match by e-mail, else by name; the child by kind).
//
//   cp household.example.json household.json      # then fill it in
//   npm run setup:household -- household.json --accounts
//
// Reads .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

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

// ---- household ---------------------------------------------------------------
const hh = cfg.household ?? {};
if (!hh.name) fail("household.name is required.");
await ok(
  admin.from("household").upsert(
    {
      id: true,
      name: hh.name,
      timezone: hh.timezone ?? "Asia/Dubai",
      currency: hh.currency ?? "AED",
      notes: hh.notes ?? null,
      milk_target_ml: hh.milk_target_ml ?? null,
      bottle_interval_min: hh.bottle_interval_min ?? null,
      hidden_modules: hh.hidden_modules ?? ["shopping"],
    },
    { onConflict: "id" },
  ),
);
console.log(`✓ household "${hh.name}" (${hh.timezone ?? "Asia/Dubai"})`);

// ---- members -----------------------------------------------------------------
const ROLES = new Set(["admin", "family_carer", "home_carer", "sitter"]);
const existing = await ok(admin.from("members").select("id, display_name, email, user_id"));
const byEmail = new Map(existing.filter((m) => m.email).map((m) => [m.email.toLowerCase(), m]));
const byName = new Map(existing.map((m) => [m.display_name.toLowerCase(), m]));
const members = [];
for (const m of cfg.members ?? []) {
  if (!m.name) fail("every member needs a name");
  if (!ROLES.has(m.role)) fail(`member ${m.name}: role must be one of ${[...ROLES].join(", ")}`);
  const email = m.email ? String(m.email).trim().toLowerCase() : null;
  const found = (email && byEmail.get(email)) || byName.get(m.name.toLowerCase());
  const row = {
    display_name: m.name,
    email,
    role_id: m.role,
    relationship: m.relationship ?? null,
    birth_date: m.birth_date ?? null,
    breastfeeds: !!m.breastfeeds,
    work_from: m.work_from ?? null,
    work_to: m.work_to ?? null,
    routine: m.routine ?? null,
    lang: m.lang ?? null,
    is_active: true,
  };
  const saved = found
    ? await ok(admin.from("members").update(row).eq("id", found.id).select("id, display_name, email, user_id").single())
    : await ok(admin.from("members").insert(row).select("id, display_name, email, user_id").single());
  members.push({ ...saved, cfg: m });
  // Work days: replace the set. Presence: set once, the app changes it afterwards.
  await ok(admin.from("work_schedules").delete().eq("member_id", saved.id));
  if (Array.isArray(m.work_days) && m.work_days.length) {
    await ok(admin.from("work_schedules").insert(m.work_days.map((d) => ({ member_id: saved.id, weekday: d }))));
  }
  const presence = await ok(admin.from("presence").select("id").eq("member_id", saved.id).limit(1));
  if (!presence.length) await ok(admin.from("presence").insert({ member_id: saved.id, state_id: m.presence ?? "lives_here" }));
  console.log(`✓ ${m.name} (${m.role})${email ? ` <${email}>` : ""}${found ? " updated" : ""}`);
}
if (!members.some((m) => m.cfg.role === "admin")) fail("at least one member must be an admin");

// ---- the child ---------------------------------------------------------------
async function subject(kind, moduleId, s, sort) {
  if (!s || !s.name) return null;
  const { name, birth_date = null, names = {}, night_from, night_to, ...profile } = s;
  const found = await ok(admin.from("care_subjects").select("id, profile, settings").eq("kind", kind).order("sort").limit(1));
  const row = {
    module_id: moduleId,
    kind,
    name,
    birth_date,
    profile: { ...(found[0]?.profile ?? {}), ...profile, names },
    settings: { ...(found[0]?.settings ?? {}), ...(night_from ? { night_from } : {}), ...(night_to ? { night_to } : {}) },
    sort,
  };
  const saved = found[0]
    ? await ok(admin.from("care_subjects").update(row).eq("id", found[0].id).select("id").single())
    : await ok(admin.from("care_subjects").insert(row).select("id").single());
  await ok(admin.from("modules").update({ label: `${name}'s log` }).eq("id", moduleId));
  console.log(`✓ ${kind}: ${name}${birth_date ? `, born ${birth_date}` : ""}${found[0] ? " updated" : ""}`);
  return saved.id;
}
const childId = await subject("child", "lana", { emergency_ambulance: "998", ...cfg.child }, 10);
if (!childId) fail("child.name is required: the app is the child's day.");

// Starting medicines for the child, only when the list is empty.
const meds = await ok(admin.from("medicines").select("id").eq("subject_id", childId).limit(1));
if (!meds.length) {
  await ok(
    admin.from("medicines").insert([
      { subject_id: childId, name: "Vitamin D drops", dose: "1 drop (400 IU)", min_gap_hours: 20, note: "Once a day." },
      { subject_id: childId, name: "Paracetamol (infant)", dose: "As the doctor wrote", min_gap_hours: 6, note: "Only if the doctor said so. Never more than 4 doses in 24 hours." },
    ]),
  );
}

// ---- sign-in accounts ------------------------------------------------------------
if (withAccounts) {
  for (const m of members) {
    if (!m.email) {
      console.log(`- ${m.display_name}: no e-mail, no account (they can be added from the Members screen later)`);
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
    if (userId) await ok(admin.from("members").update({ user_id: userId }).eq("id", m.id).is("user_id", null));
    console.log(`✓ ${m.display_name} <${m.email}> ${created?.user ? "account created" : "account already existed"}, linked`);
  }
  console.log("\nEach person signs in with their e-mail: \"Forgot password\" on the sign-in screen sets their first password.");
} else {
  console.log("\nNo accounts made (add --accounts). Anyone who creates an account with a listed e-mail is linked on first sign-in.");
}
