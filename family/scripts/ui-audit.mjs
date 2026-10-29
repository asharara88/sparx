// Measures screens against the budgets in docs/DESIGN.md. Runs against a dev server in
// screenshot mode (see the root CLAUDE.md): FAMILY_LOCAL_DB=<db> npx next dev, then
//   node scripts/ui-audit.mjs [route ...]
// Prints one line per route (blocks, cards, taps, numbers, words, screens tall) with the
// budget it breaks, and saves light and night screenshots to $AUDIT_OUT (default /tmp/ui-audit).
// Env: AUDIT_AS (auth user id for the shot_as cookie), AUDIT_URL (default http://localhost:3000).
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../", import.meta.url)); // Playwright lives at the repo root
const { chromium } = require("playwright");

const base = process.env.AUDIT_URL ?? "http://localhost:3000";
const as = process.env.AUDIT_AS ?? "00000000-0000-4000-8000-000000000002";
const out = process.env.AUDIT_OUT ?? "/tmp/ui-audit";
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ["/", "/baby", "/baby/milk", "/calendar", "/notes", "/members", "/me", "/chat"];

// docs/DESIGN.md, "Budgets". Home is stricter than every other screen.
const budget = (route) =>
  route === "/" ? { blocks: 6, numbers: 8, words: 80, screens: 1.5 } : { blocks: 8, numbers: 12, words: 150, screens: 2.5 };

mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let over = 0;
for (const theme of ["light", "night"]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light" });
  await ctx.addCookies([{ name: "shot_as", value: as, domain: new URL(base).hostname, path: "/" }]);
  // Night is the 3 am screen: force it on (or off) whatever the clock says.
  await ctx.addInitScript((t) => {
    const set = () => (t === "night" ? document.documentElement.setAttribute("data-theme", "night") : document.documentElement.removeAttribute("data-theme"));
    new MutationObserver(set).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    document.addEventListener("DOMContentLoaded", set);
  }, theme);
  const page = await ctx.newPage();
  for (const route of routes) {
    const res = await page.goto(base + route, { waitUntil: "networkidle", timeout: 240_000 });
    await page.waitForTimeout(300);
    const name = route === "/" ? "home" : route.slice(1).replaceAll("/", "_");
    await page.screenshot({ path: `${out}/${name}-${theme}.png`, fullPage: true });
    if (theme !== "light") continue;
    const m = await page.evaluate(() => {
      const main = document.querySelector("main") ?? document.body;
      const shown = (el) => {
        const s = getComputedStyle(el);
        return s.display !== "none" && s.visibility !== "hidden" && el.getBoundingClientRect().height > 0;
      };
      const column = main.querySelector(":scope > div, :scope > section") ?? main;
      const text = main.innerText;
      return {
        blocks: [...column.children].filter(shown).length,
        cards: [...main.querySelectorAll(".card, .tile, details, .action, .notice")].filter(shown).length,
        taps: [...main.querySelectorAll("a, button, summary")].filter(shown).length,
        numbers: (text.match(/\b\d+(?:[.:]\d+)?\b/g) ?? []).length,
        words: text.split(/\s+/).filter(Boolean).length,
        screens: Math.round((document.documentElement.scrollHeight / innerHeight) * 10) / 10,
      };
    });
    const b = budget(route);
    const broken = Object.keys(b).filter((k) => m[k] > b[k]).map((k) => `${k} ${m[k]} > ${b[k]}`);
    over += broken.length;
    console.log(`${route.padEnd(14)} ${res.status()}  blocks ${m.blocks}  cards ${m.cards}  taps ${m.taps}  numbers ${m.numbers}  words ${m.words}  screens ${m.screens}${broken.length ? `   OVER: ${broken.join(", ")}` : "   ok"}`);
  }
  await ctx.close();
}
await browser.close();
console.log(`\nScreenshots in ${out}. ${over ? `${over} budget(s) broken.` : "Every screen within budget."}`);
