// "{Name}'s day", end to end (docs/AGES.md, step 2): a parent signs up with a child of 13
// months, lands once on the day with the answers filled in by age, saves it, and Home's four
// rows and the tab bar follow. Then the day is changed twice from About the child and Home
// follows again. Every check prints a line; the script exits 1 if one fails.
//
// Screenshot mode (root CLAUDE.md, "The app") against a production build, where taps work,
// on a throwaway copy of the demo database (the script makes a home in it):
//   createdb -T family_shots family_day
//   FAMILY_LOCAL_DB=family_day npx next start
//   SCENARIO_DB=family_day node scripts/day-scenario.mjs
// Env: SCENARIO_DB, SCENARIO_URL (default http://localhost:3000), SCENARIO_OUT (default
// /tmp/day-scenario; a screenshot per step).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url); // Playwright: preinstalled in cloud sessions (NODE_PATH); on a laptop, npm i --no-save playwright
const { chromium } = require("playwright");

const DB = process.env.SCENARIO_DB ?? "family_day";
const base = process.env.SCENARIO_URL ?? "http://localhost:3000";
const out = process.env.SCENARIO_OUT ?? "/tmp/day-scenario";
// An account in no home yet: the parent who signs up.
const PARENT = "00000000-0000-4000-8000-00000000da01";
mkdirSync(out, { recursive: true });

const psql = (sql) => {
  const file = `${out}/q.sql`;
  writeFileSync(file, sql);
  return execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB, "-f", file], { encoding: "utf8", env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" } });
};
// Test harness only: the browser's Supabase calls go to a placeholder host in screenshot mode,
// so RPCs are answered here from the same local database, as the parent, row security on.
const lit = (v) => (v === null || v === undefined ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`);
const calls = [];
function rpc(fn, args) {
  const named = Object.entries(args ?? {}).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
  calls.push(fn);
  return psql(`\\set QUIET on\n\\o /dev/null\nselect set_config('request.jwt.claims', '{"sub":"${PARENT}","role":"authenticated"}', false);\nset role authenticated;\n\\o\nselect coalesce(to_jsonb(public.${fn}(${named})), 'null'::jsonb)::text;\n`).trim().split("\n").pop();
}

if (psql(`select count(*) from public.members where user_id = '${PARENT}';`).trim() !== "0") {
  console.error("The scenario's account already has a home in this database: use a fresh copy.");
  process.exit(1);
}
psql(`insert into auth.users (id, email) values ('${PARENT}', 'day@test.local') on conflict do nothing;`);

let failed = 0;
const check = (ok, what, got) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok || got === undefined ? "" : `: got ${JSON.stringify(got)}`}`);
};

const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: "Asia/Dubai" });
await ctx.addCookies([{ name: "shot_as", value: PARENT, domain: new URL(base).hostname, path: "/" }]);
await ctx.route("https://example.supabase.co/**", async (route) => {
  const m = new URL(route.request().url()).pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
  if (!m) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  try {
    route.fulfill({ status: 200, contentType: "application/json", body: rpc(m[1], route.request().postDataJSON()) });
  } catch (e) {
    route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: String(e.stderr ?? e) }) });
  }
});
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(`${new URL(p.url()).pathname}: ${e.message}`));
let n = 0;
const shot = (name) => p.screenshot({ path: `${out}/${String(++n).padStart(2, "0")}-${name}.png`, fullPage: true });
const pressed = async (group) => (await p.locator(`#day-form [role=group][aria-label="${group}"] button[aria-pressed=true]`).allInnerTexts()).join("");
const choose = (group, words) => p.locator(`#day-form [role=group][aria-label="${group}"]`).getByRole("button", { name: words, exact: true }).click();
const rows = async () => (await p.locator(".log-card .log-row-name").allInnerTexts()).map((s) => s.trim());
const tabs = async () => p.locator("nav.tabbar a").evaluateAll((as) => as.map((a) => (a.innerText || a.getAttribute("aria-label") || "").trim()));
const save = async () => {
  await Promise.all([p.waitForURL((u) => new URL(u).pathname === "/", { timeout: 60_000 }), p.locator(".bottom-action button[type=submit]").click()]);
  await p.waitForLoadState("networkidle");
};

// ---- 1. Sign up with a child of 13 months: 400 days old today, in Dubai.
const born = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(Date.now() - 400 * 86_400_000));
await p.goto(base + "/", { waitUntil: "networkidle" });
check((await p.locator("h1").first().innerText()).includes("Not in a home yet"), "an account in no home is asked to join or start one");
await p.getByRole("button", { name: "Start a new home" }).click();
await p.getByLabel("Your child's name").fill("Rima");
await p.getByLabel("Born").fill(born);
await p.getByRole("button", { name: "Girl", exact: true }).click();
await p.getByLabel("Your name").fill("Huda");
await shot("sign-up");
await Promise.all([p.waitForURL(/\/baby\/day\?first=1/, { timeout: 60_000 }), p.locator("form button[type=submit]").click()]);
await p.waitForLoadState("networkidle");
check(true, "after sign-up the new home opens on the child's day");

// ---- 2. The day, filled in by age.
check((await p.locator("h1").first().innerText()).trim() === "Rima's day", "the screen is titled Rima's day", await p.locator("h1").first().innerText());
const main = await p.locator("main").innerText();
check(/A start for 13 months\. Change what is different\./.test(main), "one line says the answers are a start for 13 months");
check((await pressed("Milk")) === "A drink", "milk opens on A drink (never on a clock by itself)", await pressed("Milk"));
check((await pressed("Naps a day")) === "Two", "naps open on Two at 13 months", await pressed("Naps a day"));
check((await pressed("Diapers")) === "Diapers", "diapers open on Diapers", await pressed("Diapers"));
check((await pressed("Stored milk")) === "No", "stored milk opens on No in a home with no bottle", await pressed("Stored milk"));
check((await p.getByLabel("Bedtime").inputValue()) === "19:00" && (await p.getByLabel("Morning").inputValue()) === "07:00", "bedtime and morning are the home's own, 19:00 and 07:00");
check((await p.getByRole("link", { name: "Later" }).count()) === 1, "Later stands beside Save once, after sign-up");
await shot("day-first");

// ---- 3. Save: Home's rows and the tab bar follow.
await save();
check(calls.includes("subject_day_save"), "Save calls subject_day_save");
check(JSON.stringify(await rows()) === JSON.stringify(["Meal", "Sleep", "Diaper", "Milk"]), "Home's four rows are Meal, Sleep, Diaper, Milk", await rows());
check((await tabs()).length === 4 && !(await tabs()).includes("Milk"), "the tab bar has four tabs and no Milk", await tabs());
check(!/Set up Rima's day|Look at her day/.test(await p.locator("main").innerText()), "Home no longer offers the day");
await shot("home-saved");

// ---- 4. From About the child: the saved answers, then milk and diapers not logged.
await p.goto(base + "/baby?tab=about", { waitUntil: "networkidle" });
check(/Rima's day/.test(await p.locator("main").innerText()), "About her has the row Rima's day");
await p.goto(base + "/baby/day", { waitUntil: "networkidle" });
check((await pressed("Milk")) === "A drink" && (await pressed("Naps a day")) === "Two", "opened again, the screen shows the saved answers");
check(!/Change what is different/.test(await p.locator("main").innerText()), "a saved day is not called a suggestion");
await choose("Milk", "Not logged");
await choose("Diapers", "Not logged");
await choose("Naps a day", "One");
await shot("day-changed");
await save();
check(JSON.stringify(await rows()) === JSON.stringify(["Meal", "Sleep", "Medicine", "Note"]), "with milk and diapers not logged the free slots take Medicine, then Note", await rows());
await shot("home-not-logged");

// ---- 5. A family that keeps the feed clock.
await p.goto(base + "/baby/day", { waitUntil: "networkidle" });
check((await pressed("Milk")) === "Not logged" && (await pressed("Naps a day")) === "One" && (await pressed("Diapers")) === "Not logged", "the changed answers are the ones shown");
await choose("Milk", "On a clock");
await choose("Diapers", "Diapers");
await save();
check(JSON.stringify(await rows()) === JSON.stringify(["Meal", "Sleep", "Diaper", "Feed"]), "on a clock the fourth row is Feed", await rows());
await shot("home-clock");

// ---- 6. What was stored.
const stored = JSON.parse(psql(`select settings::text from public.care_subjects s join public.members m using (household_id) where m.user_id = '${PARENT}';`).trim());
check(stored.day?.milk === "clock" && stored.day?.naps === 1 && stored.day?.diapers === "diapers" && stored.day?.stores_milk === false && stored.day?.v === 1, "the stored day is the last one saved", stored.day);
check(stored.day_asked === 12 && /^\d{4}-\d{2}-\d{2}$/.test(stored.day_asked_on ?? "") && stored.day?.saved_on === stored.day_asked_on, "the 12-month question is settled, dated on the home's day", { asked: stored.day_asked, on: stored.day_asked_on });
check(errs.length === 0, "no page error", errs);

await b.close();
console.log(failed ? `\n${failed} check(s) failed. Screenshots in ${out}` : `\nAll checks passed. Screenshots in ${out}`);
process.exit(failed ? 1 : 0);
