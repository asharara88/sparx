// Side-by-side walk: every route, as each person, on the old build and the new one.
//   node walk.cjs <label> [who ...]
// Old build on :3100, new on :3200 (serve.sh). Saves each page's visible text to
// $WALK_OUT/runs/<label>/<who>/<page>.{before,after}.txt; the first line is "# <route> (<status>)" or
// "# <route> ERROR <message>". Home's log rows are opened one by one (the sheets), as a tap.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const label = process.argv[2] ?? "run";
const PEOPLE = {
  mido: "00000000-0000-4000-8000-000000000001", dana: "00000000-0000-4000-8000-000000000002",
  wafa: "00000000-0000-4000-8000-000000000003", lilly: "00000000-0000-4000-8000-000000000005",
  noor12: "00000000-0000-4000-8000-000000001200", adam18: "00000000-0000-4000-8000-000000001800",
  maya24: "00000000-0000-4000-8000-000000002400", yusuf36: "00000000-0000-4000-8000-000000003600",
  noorcarer: "00000000-0000-4000-8000-000000001201", noorsimple: "00000000-0000-4000-8000-000000001202",
  nohome: "00000000-0000-4000-8000-00000000ffff",
};
// The carer and the simple-screen member of Noor's home exist only with DAYS=1 (toddler_days.sql).
const who = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(PEOPLE).filter((k) => process.env.DAYS || !["noorcarer", "noorsimple"].includes(k));
const ROUTES = (process.env.WALK_ROUTES ? process.env.WALK_ROUTES.split(",") : [
  "/", "/baby", "/baby?tab=week", "/baby?tab=about", "/baby/milk", "/baby/sleep", "/baby/feed", "/baby/trends",
  // Trends is one chart a screen since 25 November: the four that carry the rules by age and by sex
  // (a chart the child has none of opens the first one).
  "/baby/trends?chart=age", "/baby/trends?chart=feeds", "/baby/trends?chart=diapers", "/baby/trends?chart=weight",
  "/baby/doctor", "/baby/emergency", "/baby/when-to-call", "/baby/vaccines", "/baby/medicine", "/baby/milestones",
  "/baby/weeks", "/baby/activities", "/baby/story", "/baby/handover", "/baby/export", "/baby/day", "/calendar", "/notes", "/chat",
  "/ask", "/ask/memory", "/ask/skills", "/achievements", "/members", "/members/home", "/members/roles",
  "/members/types", "/me", "/me/display", "/me/homes", "/me/homes/new", "/me/install", "/me/notifications",
  "/me/password", "/me/presence", "/welcome",
]);
const SIDES = [["before", "http://localhost:3100"], ["after", "http://localhost:3200"]];
const OUT = path.join(process.env.WALK_OUT ?? "/tmp/elnunu-walk", "runs", label);

const name = (r) => (r === "/" ? "home" : r.slice(1).replace(/[/?=&]/g, "_"));
const text = (page) => page.evaluate(() => (document.querySelector("main") ?? document.body).innerText);

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  for (const w of who) {
    const dir = path.join(OUT, w);
    fs.mkdirSync(dir, { recursive: true });
    // Both builds side by side, page by page, so the clock moves the same on each.
    const open = await Promise.all(SIDES.map(async ([side, base]) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.addCookies([{ name: "shot_as", value: PEOPLE[w], domain: "localhost", path: "/" }]);
      return { side, base, ctx, page: await ctx.newPage() };
    }));
    for (const r of ROUTES) {
      await Promise.all(open.map(async ({ side, base, page }) => {
        let body;
        try {
          const res = await page.goto(base + r, { waitUntil: "networkidle", timeout: 120_000 });
          await page.waitForTimeout(250);
          body = `# ${r} (${res ? res.status() : "?"})\n` + (await text(page));
        } catch (e) {
          body = `# ${r} ERROR ${String(e.message).split("\n")[0]}`;
        }
        fs.writeFileSync(path.join(dir, `${name(r)}.${side}.txt`), body);
      }));
    }
    for (const { side, base, ctx, page } of open) {
      // Home's sheets: open each log row in turn.
      try {
        await page.goto(base + "/", { waitUntil: "networkidle", timeout: 120_000 });
        const rows = await page.locator(".log-card .log-row-body").all();
        for (let i = 0; i < rows.length; i++) {
          await page.goto(base + "/", { waitUntil: "networkidle", timeout: 120_000 });
          const row = page.locator(".log-card .log-row-body").nth(i);
          const rowName = ((await row.innerText()).split("\n")[0] || `row${i}`).trim().toLowerCase().replace(/\W+/g, "-");
          await row.click();
          await page.waitForTimeout(900);
          const dialog = page.locator("[role=dialog]").last();
          const body = (await dialog.count()) ? await dialog.innerText() : "(no sheet)";
          fs.writeFileSync(path.join(dir, `sheet-${rowName}.${side}.txt`), `# sheet ${rowName}\n${body}`);
        }
      } catch (e) {
        fs.writeFileSync(path.join(dir, `sheets.${side}.txt`), `# sheets ERROR ${String(e.message).split("\n")[0]}`);
      }
      // The tab bar (on Home and on the child's page) and the + sheet: they sit outside <main>.
      try {
        for (const [at, r] of [["home", "/"], ["baby", "/baby"], ["milk", "/baby/milk"]]) {
          await page.goto(base + r, { waitUntil: "networkidle", timeout: 120_000 });
          const bar = page.locator("nav.tabbar");
          const tabs = (await bar.count()) ? await bar.locator("a").evaluateAll((as) => as.map((a) => `${(a.innerText || a.getAttribute("aria-label") || "").trim()}${a.getAttribute("aria-current") ? " *" : ""}`).join(" | ")) : "(no tab bar)";
          fs.writeFileSync(path.join(dir, `tabbar-${at}.${side}.txt`), `# tab bar on ${r}\n${tabs}`);
        }
        await page.goto(base + "/", { waitUntil: "networkidle", timeout: 120_000 });
        const plus = page.locator("nav.tabbar .tab-log");
        if (await plus.count()) {
          await plus.click();
          await page.waitForTimeout(900);
          const dialog = page.locator("[role=dialog]").last();
          const body = (await dialog.count()) ? await dialog.innerText() : "(no sheet)";
          fs.writeFileSync(path.join(dir, `sheet-plus.${side}.txt`), `# sheet plus\n${body}`);
        }
      } catch (e) {
        fs.writeFileSync(path.join(dir, `tabbar.${side}.txt`), `# tabbar ERROR ${String(e.message).split("\n")[0]}`);
      }
      await ctx.close();
    }
    console.log(`${w}: done`);
  }
  await browser.close();
})();
