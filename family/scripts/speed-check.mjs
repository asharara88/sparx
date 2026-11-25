// Is the app fast and responsive? Measures the screens a person opens every day against the
// budgets below, on a production build in screenshot mode (see the root CLAUDE.md):
//   FAMILY_LOCAL_DB=<db> npx next start      (after next build, with the two example env values)
//   SPEED_DB=<db> node scripts/speed-check.mjs
// It runs every Monday in .github/workflows/speed-check.yml, which opens one issue when a
// budget is broken and closes it when the check is clean again.
//
// What it reads, per screen, on a phone-sized page with the processor slowed four times
// (a mid-range phone), each a fresh visit with nothing cached:
//   db      database calls the screen makes. Exact, and the thing that costs most on the live
//           app: each is a round trip from Vercel to Supabase. Counted from Postgres's own
//           session statistics (screenshot mode opens one psql session per call).
//   js      kB of JavaScript the screen loads, uncompressed. Exact for a build.
//   lcp     ms until the largest thing on the screen is painted.
//   blocked ms the page could not answer a tap while loading (long tasks, the part over 50 ms).
//   shift   how much the layout jumped while loading (CLS).
// And a few taps, for responsiveness: ms from the tap until what it opens is on the screen.
//
// The first two are exact, so their budgets sit just above today's figures and catch creep:
// one database call more than a screen makes today, and 5% more JavaScript.
// The timings move with the machine, so their budgets are lines, not today's figures: painted
// inside 2.5 s and a layout shift under 0.1 (the web's own "good" lines); blocked under 400 ms
// (twice the slowest screen on 25 November; Lighthouse calls under 200 good and over 600
// poor); a tap answered inside 300 ms (the web's line is 200, and this reading includes the
// test's own hand reaching the screen). The server's own answer time is printed but has no
// budget: in screenshot mode it is mostly psql starting.
//
// Env: SPEED_URL (default http://localhost:3000), SPEED_DB (the database the server reads;
// without it the db column is left out), PSQL and PGPASSWORD as for `npm run db:test`
// (default "psql -h localhost -U postgres" and "postgres"; it must not connect to SPEED_DB
// itself, or it would count its own visits), SPEED_RUNS (default 3; timings are the median),
// SPEED_CPU (default 4), SPEED_OUT (default /tmp/speed-check: report.md and report.json),
// CHROMIUM (the browser to launch; the cloud sessions' own is found by itself).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url); // Playwright: preinstalled in cloud sessions (NODE_PATH); elsewhere, npm i --no-save playwright
const { chromium } = require("playwright");

const base = process.env.SPEED_URL ?? "http://localhost:3000";
const db = process.env.SPEED_DB ?? null;
const runs = Number(process.env.SPEED_RUNS) || 3;
const cpu = Number(process.env.SPEED_CPU) || 4;
const out = process.env.SPEED_OUT ?? "/tmp/speed-check";

const ADMIN = "00000000-0000-4000-8000-000000000002";
const SIMPLE = "00000000-0000-4000-8000-000000000003"; // the family carer on the simple screen

// Every screen (see the top of the file for where each line comes from).
const EVERY = { lcp: 2500, blocked: 400, shift: 0.1 };
// Per screen: database calls (one more than the build of 25 November 2026 made: Home 9, the
// simple Home 6, Today 5, Week 10, Feeds 5, Sleep 4, Milk 5, Trends 4, Calendar 5, More 4) and
// kB of JavaScript (5% over what it loaded, to the next ten). Raise one only with the reason
// in the pull request that needs it; lower it when a screen gets lighter.
const SCREENS = [
  { name: "Home", route: "/", db: 10, js: 940 },
  { name: "Home, simple screen", route: "/", as: SIMPLE, db: 7, js: 940 },
  { name: "Child, Today", route: "/baby", db: 6, js: 920 },
  { name: "Child, Week", route: "/baby?tab=week", db: 11, js: 920 },
  { name: "Feeds", route: "/baby/feed", db: 6, js: 900 },
  { name: "Sleep", route: "/baby/sleep", db: 5, js: 900 },
  { name: "Milk", route: "/baby/milk", db: 6, js: 870 },
  { name: "Trends", route: "/baby/trends", db: 5, js: 880 },
  { name: "Calendar", route: "/calendar", db: 6, js: 870 },
  { name: "More", route: "/me", db: 5, js: 860 },
];
// Taps. `shown` runs in the page and is true once what the tap opens is there. A tap that
// stays on the screen should answer inside 300 ms; one that opens another screen waits for
// the server too, so its line is a second and a half.
const TAPS = [
  { name: "Home: the feed sheet opens", route: "/", tap: 'button[aria-label="Log a feed"]', shown: () => !!document.querySelector('.sheet[role="dialog"]'), ms: 300 },
  { name: "Week: a row opens", route: "/baby?tab=week", tap: "details.fold-flat > summary", shown: () => !!document.querySelector("details.fold-flat[open] .fold-body"), ms: 300 },
  { name: "Home to Milk, by the tab bar", route: "/", tap: '.tabbar a[href="/baby/milk"]', shown: () => location.pathname === "/baby/milk" && !!document.querySelector("main h1"), ms: 1500 },
  { name: "Feeds: the day before", route: "/baby/feed", tap: 'nav.daypager a[aria-label="The day before"]', shown: () => location.search.includes("day="), ms: 1500 },
];

/** Sessions opened on the app's database so far: one per call the app made. */
function sessions() {
  if (!db) return null;
  try {
    const psql = process.env.PSQL ?? "psql -h localhost -U postgres";
    const sql = `select sessions from pg_stat_database where datname = '${db.replace(/'/g, "''")}'`;
    const got = execFileSync("bash", ["-c", `${psql} -X -A -t -q -c "${sql}"`], { encoding: "utf8", env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" } }).trim();
    return got === "" ? null : Number(got);
  } catch {
    return null;
  }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sandbox = "/opt/pw-browsers/chromium";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? (existsSync(sandbox) ? sandbox : undefined) });
const origin = new URL(base).origin;

async function open(as) {
  // No service worker and nothing from another site: each visit is a first visit to this build alone.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  await ctx.addCookies([{ name: "shot_as", value: as ?? ADMIN, domain: new URL(base).hostname, path: "/" }]);
  await ctx.route((url) => url.origin !== origin, (route) => route.abort());
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  await page.addInitScript(() => {
    const s = (window.__speed = { lcp: 0, shift: 0, blocked: 0 });
    const watch = (type, each) => {
      try {
        new PerformanceObserver((list) => list.getEntries().forEach(each)).observe({ type, buffered: true });
      } catch {
        /* a browser without this entry type: the figure stays 0 */
      }
    };
    watch("largest-contentful-paint", (e) => (s.lcp = Math.max(s.lcp, e.startTime)));
    watch("layout-shift", (e) => !e.hadRecentInput && (s.shift += e.value));
    watch("longtask", (e) => (s.blocked += Math.max(0, e.duration - 50)));
  });
  return { ctx, page };
}

async function visit(screen) {
  const { ctx, page } = await open(screen.as);
  const scripts = [];
  page.on("response", (res) => {
    if (res.request().resourceType() === "script") scripts.push(res.body().then((b) => b.length, () => 0));
  });
  const before = sessions();
  const res = await page.goto(base + screen.route, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(400); // the last paint and the last long task are reported a moment after the load
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return { server: nav ? nav.responseStart - nav.requestStart : 0, lcp: window.__speed.lcp, shift: window.__speed.shift, blocked: window.__speed.blocked };
  });
  const after = sessions();
  const js = (await Promise.all(scripts)).reduce((a, b) => a + b, 0);
  await ctx.close();
  return { status: res?.status() ?? 0, db: before == null || after == null ? null : after - before, js: Math.round(js / 1024), ...m };
}

async function tap(t) {
  const { ctx, page } = await open(t.as);
  await page.goto(base + t.route, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(400);
  const target = page.locator(t.tap).first();
  await target.scrollIntoViewIfNeeded();
  const started = Date.now();
  await target.tap();
  await page.waitForFunction(t.shown, null, { timeout: 30_000, polling: "raf" });
  const ms = Date.now() - started;
  await ctx.close();
  return ms;
}

const rows = [];
const over = [];
for (const screen of SCREENS) {
  const got = [];
  for (let i = 0; i < runs; i++) got.push(await visit(screen));
  const r = {
    name: screen.name,
    route: screen.route,
    status: got[0].status,
    // Exact figures: the largest seen (they should all agree). Timings: the median.
    db: got.some((g) => g.db == null) ? null : Math.max(...got.map((g) => g.db)),
    js: Math.max(...got.map((g) => g.js)),
    server: Math.round(median(got.map((g) => g.server))),
    lcp: Math.round(median(got.map((g) => g.lcp))),
    blocked: Math.round(median(got.map((g) => g.blocked))),
    shift: Math.round(median(got.map((g) => g.shift)) * 1000) / 1000,
  };
  const broke = [];
  if (r.status !== 200) broke.push(`answered ${r.status}`);
  if (r.db != null && r.db > screen.db) broke.push(`database calls ${r.db} > ${screen.db}`);
  if (r.js > screen.js) broke.push(`JavaScript ${r.js} kB > ${screen.js} kB`);
  if (r.lcp > EVERY.lcp) broke.push(`painted in ${r.lcp} ms > ${EVERY.lcp} ms`);
  if (r.blocked > EVERY.blocked) broke.push(`blocked ${r.blocked} ms > ${EVERY.blocked} ms`);
  if (r.shift > EVERY.shift) broke.push(`layout shift ${r.shift} > ${EVERY.shift}`);
  if (broke.length) over.push(`${screen.name} (\`${screen.route}\`): ${broke.join("; ")}`);
  rows.push({ ...r, budget: { db: screen.db, js: screen.js }, broke });
}
const taps = [];
for (const t of TAPS) {
  const got = [];
  let failed = null;
  for (let i = 0; i < runs && !failed; i++) {
    try {
      got.push(await tap(t));
    } catch (e) {
      failed = String(e).split("\n")[0].slice(0, 160);
    }
  }
  const ms = failed ? null : median(got);
  const broke = failed ? `could not be done: ${failed}` : ms > t.ms ? `${ms} ms > ${t.ms} ms` : null;
  if (broke) over.push(`${t.name}: ${broke}`);
  taps.push({ name: t.name, ms, budget: t.ms, broke });
}
await browser.close();

const mark = (n, max) => (n > max ? `**${n}**` : `${n}`);
const report = [
  `Speed check of ${new Date().toISOString().slice(0, 10)}: ${over.length ? `${over.length} over budget` : "every screen inside its budget"}. A phone-sized page, the processor slowed ${cpu} times, ${runs} first visits each.`,
  "",
  "| Screen | Database calls | JavaScript, kB | Painted, ms | Blocked, ms | Layout shift | Server, ms |",
  "|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.name} | ${r.db == null ? "not counted" : `${mark(r.db, r.budget.db)} of ${r.budget.db}`} | ${mark(r.js, r.budget.js)} of ${r.budget.js} | ${mark(r.lcp, EVERY.lcp)} | ${mark(r.blocked, EVERY.blocked)} | ${mark(r.shift, EVERY.shift)} | ${r.server} |`),
  `| Budget | per screen | per screen | ${EVERY.lcp} | ${EVERY.blocked} | ${EVERY.shift} | none |`,
  "",
  "| Tap | Until it is on the screen, ms | Budget |",
  "|---|---|---|",
  ...taps.map((t) => `| ${t.name} | ${t.ms == null ? "**failed**" : mark(t.ms, t.budget)} | ${t.budget} |`),
  ...(over.length ? ["", "Over budget:", "", ...over.map((o) => `- ${o}`)] : []),
  ...(db ? [] : ["", "Database calls were not counted: SPEED_DB was not set."]),
].join("\n");
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/report.md`, report + "\n");
writeFileSync(`${out}/report.json`, JSON.stringify({ at: new Date().toISOString(), cpu, runs, screens: rows, taps, over }, null, 2) + "\n");
console.log(report);
process.exit(over.length ? 1 : 0);
