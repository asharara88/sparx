// Measures screens against the budgets in docs/DESIGN.md. Runs against a dev server in
// screenshot mode (see the root CLAUDE.md): FAMILY_LOCAL_DB=<db> npx next dev, then
//   node scripts/ui-audit.mjs [route ...]
// Prints one line per route (blocks, cards, taps, numbers, words, screens tall) with the
// budget it breaks, then the phone checks (DESIGN.md, "Built for a phone"): anything wider
// than the screen, short labels that break onto two lines, tables, a card inside a card,
// tap targets under 44 px, text under 13 px. Folds are opened first so what hides in them
// counts. Saves light and night screenshots to $AUDIT_OUT (default /tmp/ui-audit).
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
  route === "/" ? { blocks: 6, numbers: 15, words: 80, screens: 1 } : { blocks: 8, numbers: 12, words: 150, screens: 2.5 };

mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let over = 0;
for (const theme of ["light", "night"]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light" });
  await ctx.addCookies([{ name: "shot_as", value: as, domain: new URL(base).hostname, path: "/" }]);
  const page = await ctx.newPage();
  for (const route of routes) {
    const res = await page.goto(base + route, { waitUntil: "networkidle", timeout: 240_000 });
    // Night is the 3 am screen. Force it on (or off) right before the shot, whatever the
    // clock says: the app's own night switch runs after load and would otherwise win.
    await page.evaluate((t) => (t === "night" ? document.documentElement.setAttribute("data-theme", "night") : document.documentElement.removeAttribute("data-theme")), theme);
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
        blocks: [...column.children].filter((el) => shown(el) && !el.classList.contains("grow-space")).length, // a spacer is not a block
        cards: [...main.querySelectorAll(".card, .tile, details, .action, .notice")].filter(shown).length,
        taps: [...main.querySelectorAll("a, button, summary")].filter(shown).length,
        numbers: (text.match(/\b\d+(?:[.:]\d+)?\b/g) ?? []).length,
        words: text.split(/\s+/).filter(Boolean).length,
        screens: Math.round((document.documentElement.scrollHeight / innerHeight) * 10) / 10,
      };
    });
    // The phone checks look inside every fold, so open them all first.
    await page.evaluate(() => document.querySelectorAll("main details").forEach((d) => (d.open = true)));
    await page.waitForTimeout(150);
    const phone = await page.evaluate(() => {
      const main = document.querySelector("main") ?? document.body;
      const shown = (el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.height > 0 && r.width > 0;
      };
      const all = (sel) => [...main.querySelectorAll(sel)].filter(shown);
      const label = (el) => el.innerText.replace(/\s+/g, " ").trim().slice(0, 40);
      // Does one run of words break onto a second line? Each text node is measured on its own,
      // so an icon beside a label, or a label over a sub-label, is not counted as a break.
      const breaks = (el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const tops = new Set([...range.getClientRects()].filter((r) => r.width > 1).map((r) => Math.round(r.top)));
          if (tops.size > 1) return true;
        }
        return false;
      };
      const wide = all("*").filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.right <= innerWidth + 1 && r.left >= -1) return false;
        for (let p = el.parentElement; p && p !== main; p = p.parentElement) if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowX)) return false;
        return true;
      });
      const sideways = all("*").filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 4);
      const wrapped = all("button, .pill, .chip, th, dt, [role=tab], summary, .tile span, .action-label, .action-sub").filter((el) => {
        const t = label(el);
        return t.length > 0 && t.length <= 24 && !el.querySelector("button, .pill, .chip") && breaks(el);
      });
      // A box you can see: its own background, border or shadow. Cards that sit flat on their
      // parent (DESIGN.md: whatever is inside a fold sits flat) are not a second box.
      const boxed = (el) => {
        const s = getComputedStyle(el);
        const bg = s.backgroundColor.match(/[\d.]+/g) ?? [];
        return (bg.length === 4 ? Number(bg[3]) > 0 : bg.length === 3) || s.boxShadow !== "none" || parseFloat(s.borderTopWidth) > 0;
      };
      const nested = all(".card .card, .card .tile, .card .notice, details .card, details details, .tile .card").filter(boxed);
      const small = all("a, button, summary, input, select").filter((el) => {
        if (el.tagName === "A" && el.closest("p, li > span, dd")) return false; // a link inside a sentence
        const r = el.getBoundingClientRect();
        return r.height < 43.5;
      });
      const tiny = all("*").filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 13);
      const pick = (els) => [...new Set(els.map(label).filter(Boolean))].slice(0, 4);
      return {
        wide: wide.length, sideways: sideways.length, tables: all("table").length, wrapped: wrapped.length, nested: nested.length, small: small.length, tiny: tiny.length,
        examples: { wrapped: pick(wrapped), nested: pick(nested), small: pick(small) },
      };
    });
    const issues = Object.entries({ wide: phone.wide, sideways: phone.sideways, tables: phone.tables, "wrapped labels": phone.wrapped, "card in card": phone.nested, "small taps": phone.small, "tiny text": phone.tiny }).filter(([, n]) => n > 0);
    over += issues.length;
    const b = budget(route);
    const broken = Object.keys(b).filter((k) => m[k] > b[k]).map((k) => `${k} ${m[k]} > ${b[k]}`);
    over += broken.length;
    console.log(`${route.padEnd(14)} ${res.status()}  blocks ${m.blocks}  cards ${m.cards}  taps ${m.taps}  numbers ${m.numbers}  words ${m.words}  screens ${m.screens}${broken.length ? `   OVER: ${broken.join(", ")}` : "   ok"}`);
    console.log(`${"".padEnd(18)}phone: ${issues.length ? issues.map(([k, n]) => `${k} ${n}`).join(", ") : "ok"}`);
    for (const [k, v] of Object.entries(phone.examples)) if (v.length) console.log(`${"".padEnd(18)}  ${k}: ${v.map((t) => JSON.stringify(t)).join(", ")}`);
  }
  await ctx.close();
}
await browser.close();
console.log(`\nScreenshots in ${out}. ${over ? `${over} budget(s) or phone check(s) broken.` : "Every screen within budget."}`);
