// Creates the sign-in accounts for the seeded members and links them.
// Run from your machine (never from the browser):
//   npm run seed:accounts
// Reads .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MEMBER_EMAILS.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

// "Dana=dana@x.com,Wafa=wafa@x.com" -> { Dana: 'dana@x.com', ... }
const emails = Object.fromEntries(
  (process.env.MEMBER_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => pair.split("=").map((x) => x.trim()))
    .filter(([n, e]) => n && e && e.includes("@"))
    .map(([n, e]) => [n, e.toLowerCase()]),
);

const { data: members, error } = await admin.from("members").select("id, display_name, email, user_id").eq("is_active", true);
if (error) throw error;

for (const m of members) {
  const email = emails[m.display_name] ?? m.email;
  if (!email) {
    console.log(`- ${m.display_name}: no e-mail yet (add it in MEMBER_EMAILS or in the Members screen)`);
    continue;
  }
  if (m.email !== email) {
    const { error: e1 } = await admin.from("members").update({ email }).eq("id", m.id);
    if (e1) throw e1;
  }
  // Create the auth user if missing. The database trigger links it to the member row by e-mail.
  const { data: created, error: e2 } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (e2 && !/already|exists|registered/i.test(e2.message)) throw e2;
  let userId = created?.user?.id;
  if (!userId) {
    // already exists: find it and link explicitly
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    userId = list?.users?.find((u) => u.email?.toLowerCase() === email)?.id;
  }
  if (userId) {
    const { error: e3 } = await admin.from("members").update({ user_id: userId }).eq("id", m.id).is("user_id", null);
    if (e3) throw e3;
  }
  console.log(`✓ ${m.display_name} <${email}> ${created?.user ? "account created" : "account already existed"}, linked`);
}
console.log("\nDone. Each person signs in at the app with their e-mail; a link is sent to them.");
