// Logging what already happened, from Home: the acceptance scenario for Dana's second ask.
// It is 14:00; a 90 ml bottle at 12:40 and a nap 13:00-13:45 were never logged. Dana logs
// both from Home's rows; every tap is counted and photographed, then the child's Today list
// and the edit sheet (tap an entry) are checked. Also: the overlap warning, and no keyboard on Home's sheets.
//
// Screenshot mode (root CLAUDE.md, "The app") on a fresh copy of the demo database whose
// day stops in the morning (the demo's own does), as in:
//   createdb -T family_shots family_accept
//   FAKE_NOW=2026-10-29T14:00:00+04:00 NODE_OPTIONS="--require ./scripts/fake-clock.cjs" \
//     FAMILY_LOCAL_DB=family_accept npx next start   (production build: taps work)
// The server's clock must sit on the scenario's day too (fake-clock.cjs), or Home's list of
// recent entries starts after the morning and the overlap warning cannot fire.
//   SCENARIO_DB=family_accept node scripts/backlog-scenario.mjs
// Env: SCENARIO_DB, SCENARIO_URL (default http://localhost:3000), SCENARIO_OUT (default
// /tmp/backlog-scenario), SCENARIO_DAY (the demo log's day, default today in Dubai: the
// browser clock is set to 14:00 on it). Writes go to that database, so use a throwaway copy.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../", import.meta.url)); // Playwright lives at the repo root
const { chromium } = require("playwright");
// Test harness only: the browser's Supabase calls go to a placeholder host in screenshot
// mode, so RPCs are answered here from the same local database, as Dana, row security on.
const DB = process.env.SCENARIO_DB ?? "family_accept";
const DANA = "00000000-0000-4000-8000-000000000002";
const lit = (v) => v === null || v === undefined ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const rpcLog = [];
function rpc(fn, args) {
  const named = Object.entries(args ?? {}).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
  const file = `${out}/q.sql`;
  writeFileSync(file, `\\set QUIET on\n\\o /dev/null\nselect set_config('request.jwt.claims', '{"sub":"${DANA}","role":"authenticated"}', false);\nset role authenticated;\n\\o\nselect coalesce(to_jsonb(public.${fn}(${named})), 'null'::jsonb)::text;\n`);
  const res = execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB, "-f", file], { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } });
  rpcLog.push(fn);
  return res.trim().split("\n").pop();
}
const out = process.env.SCENARIO_OUT ?? "/tmp/backlog-scenario";
const base = process.env.SCENARIO_URL ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: "Asia/Dubai" });
await ctx.addCookies([{ name: "shot_as", value: DANA, domain: new URL(base).hostname, path: "/" }]);
await ctx.route("https://example.supabase.co/**", async (route) => {
  const url = new URL(route.request().url());
  const m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
  if (!m) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  try {
    route.fulfill({ status: 200, contentType: "application/json", body: rpc(m[1], route.request().postDataJSON()) });
  } catch (e) {
    route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: String(e.stderr ?? e) }) });
  }
});
const p = await ctx.newPage();
const day = process.env.SCENARIO_DAY ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
await p.clock.install({ time: Date.parse(`${day}T14:00:00+04:00`) });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
let n = 0;
const shot = async (name) => p.screenshot({ path: `${out}/${String(++n).padStart(2, "0")}-${name}.png` });
const taps = { bottle: [], nap: [] };
const tap = async (flow, label, loc) => {
  await loc.click();
  taps[flow].push(label);
  await p.waitForTimeout(400);
  await shot(`${flow}-${taps[flow].length}-${label.replace(/[^a-z0-9]+/gi, "_")}`);
};
const keyboardInputs = () => p.locator(".sheet input:visible, .sheet textarea:visible, .sheet select:visible").count();

await p.goto(`${base}/`, { waitUntil: "networkidle" });
await shot("home-start");

// ---- the bottle: Feed's start button, When, 12:40, 90 ml (the sheet opens on Bottle: the last feed was one)
await tap("bottle", "Feed ▶", p.getByRole("button", { name: "Start a feed" }));
const kbFeed = await keyboardInputs();
await tap("bottle", "When: now · earlier?", p.getByRole("button", { name: /^When: now/ }));
await tap("bottle", "12:40", p.getByRole("button", { name: "12:40", exact: true }));
const usual = await p.locator('.sheet button[aria-pressed="true"]', { hasText: " ml" }).allInnerTexts();
await tap("bottle", "90 ml", p.getByRole("button", { name: "90 ml", exact: true }));
const bottleMsg = await p.locator('[role="status"]').first().innerText().catch(() => "");

// ---- the nap: the Sleep row (its sheet opens on the clock times), 13:00, woke 13:45
await tap("nap", "Sleep row", p.locator("button.log-row-body", { hasText: "Sleep" }));
const recalled = await p.locator('.sheet [role="group"] button[aria-pressed="true"]').allInnerTexts();
await tap("nap", "13:00", p.getByRole("button", { name: "13:00", exact: true }));
await tap("nap", "woke 13:45", p.getByRole("button", { name: /^Woke at 13:45/ }));
const napMsg = await p.locator('[role="status"]').first().innerText().catch(() => "");

// The fixed browser clock disagrees with the server's: React reports hydration text
// mismatches (#418) here, and only here.
// ---- overlap (Napper's collision): a second nap from 13:10 lands on the one just logged.
// Wait out the one-minute recall first so this sheet starts on now, as it would later.
await p.clock.runFor(65_000);
await p.locator("button.log-row-body", { hasText: "Sleep" }).click();
await p.getByRole("button", { name: "13:10", exact: true }).click();
await p.getByRole("button", { name: /^Woke at 13:30/ }).click();
await p.waitForTimeout(300);
const clash = await p.locator('.sheet [role="alert"]').innerText().catch(() => "(no warning)");
await shot("overlap-warning");
await p.keyboard.press("Escape");

// ---- no keyboard on the Home sheets (Nara's keypad): Nappy and Pump too
await p.locator("button.log-row-body", { hasText: "Nappy" }).click();
const kbNappy = await keyboardInputs();
await p.keyboard.press("Escape");
await p.locator("button.log-row-body", { hasText: "Pump" }).click();
const kbPump = await keyboardInputs();
await shot("pump-sheet");
await p.keyboard.press("Escape");
await p.waitForTimeout(300);
await shot("home-after");

// ---- the child's page, Today: both entries, times, length, who
await p.goto(`${base}/baby?tab=today&d=${day}`, { waitUntil: "networkidle" });
await shot("child-today");
const rows = await p.locator("li.row").allInnerTexts();
const mine = rows.filter((r) => /^12:40|^13:00/.test(r.trim())).map((r) => r.replace(/\s+/g, " ").trim());
// ---- Huckleberry's edit path: tap the entry, then the time field
const editTaps = [];
await p.locator("li.row button", { hasText: "12:40" }).first().click();
editTaps.push("the 12:40 row");
await p.waitForSelector(".sheet");
await shot("edit-entry");
const timeField = p.locator('.sheet input[type="datetime-local"]').first();
const timeValue = await timeField.inputValue().catch(() => null);
const pickers = await p.locator('.sheet input[type="datetime-local"]').count();
const del = await p.locator(".sheet").getByRole("button", { name: /delete/i }).count();
console.log(JSON.stringify({ taps: { bottle: taps.bottle, nap: taps.nap }, usual, recalledOnNapSheet: recalled, bottleMsg, napMsg, clash, keyboardInputs: { feed: kbFeed, nappy: kbNappy, pump: kbPump }, childToday: mine, editTaps, editPickers: pickers, editTimeValue: timeValue, editDelete: del, errors: errs, rpcs: rpcLog }, null, 2));
await b.close();
