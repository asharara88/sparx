// Measures screens against the budgets in docs/DESIGN.md. Runs against a dev server in
// screenshot mode (see the root CLAUDE.md): FAMILY_LOCAL_DB=<db> npx next dev, then
//   node scripts/ui-audit.mjs [route ...]
// Prints one line per route (blocks, cards, taps, numbers, words, screens tall) with the
// budget it breaks, then the phone checks (DESIGN.md, "Built for a phone"): anything wider
// than the screen, short labels that break onto two lines, tables, a card inside a card,
// tap targets under 44 px, text under 13 px. Folds are opened first so what hides in them
// counts. Saves light and night screenshots to $AUDIT_OUT (default /tmp/ui-audit).
// Env: AUDIT_AS (auth user id for the shot_as cookie), AUDIT_URL (default http://localhost:3000),
// AUDIT_NOW (an ISO time: the browser's clock is held there, to match a server started with
// scripts/fake-clock.cjs on a demo day shifted to that time), AUDIT_W (the phone's width in px,
// default 390; 320 is the smallest the bible names: run the phone checks there too after a
// change to margins or type), AUDIT_CUT=1 (also list the one-line labels that are cut with "…":
// not a check, a list to compare before and after such a change, at 320, 360, 375 and 390).
// A closed select counts as the one option it shows, a tick box or radio as the label it sits
// in, and the wordmark's small "el" (.wordmark, .wordmark-ar) is not tiny text.
// A group that is one thing to a person but is built of several (the simple Home's four log
// tiles, as Home's log card is) is marked data-block on its wrapper and counts as one.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url); // Playwright: preinstalled in cloud sessions (NODE_PATH); on a laptop, npm i --no-save playwright
const { chromium } = require("playwright");

const base = process.env.AUDIT_URL ?? "http://localhost:3000";
const as = process.env.AUDIT_AS ?? "00000000-0000-4000-8000-000000000002";
const out = process.env.AUDIT_OUT ?? "/tmp/ui-audit";
// With no routes given it sweeps every screen (the list below; add a screen here when it is built).
const ALL = [
  "/", "/baby", "/baby?tab=week", "/baby?tab=about", "/baby/day", "/baby/milk", "/baby/sleep", "/baby/feed", "/baby/trends",
  "/baby/doctor", "/baby/emergency", "/baby/when-to-call", "/baby/vaccines", "/baby/medicine", "/baby/milestones",
  "/baby/weeks", "/baby/activities", "/baby/story", "/baby/handover", "/calendar", "/notes", "/chat", "/ask",
  "/ask/memory", "/ask/skills", "/achievements", "/members", "/members/home", "/members/roles", "/members/types",
  "/me", "/me/display", "/me/homes", "/me/homes/new", "/me/install", "/me/notifications", "/me/password", "/me/presence",
];
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

// docs/DESIGN.md, "Budgets". Home's first screen (.screen-fill: now, the alert, the log rows)
// is stricter than every other screen; the day's cards below it (#today) count as a screen of
// their own.
const HOME = { blocks: 6, numbers: 15, words: 80, screens: 1 };
const OTHER = { blocks: 8, numbers: 12, words: 150, screens: 2.5 };
// The child's day has a budget of its own (docs/DESIGN.md, "The child's day"), held only where the
// screen opened: a baby's home and anyone but a parent are sent to About the child, which keeps
// the general budget. Run it with AUDIT_AS set to the parent of a child of 12 months or more.
const DAY = { blocks: 5, numbers: 4, words: 100, screens: 1.5 };
const parts = (route, landed) => (route === "/" ? [["/ first screen", ".screen-fill", HOME], ["/ below", "#today", OTHER]] : [[route, null, landed === "/baby/day" ? DAY : OTHER]]);

mkdirSync(out, { recursive: true });
// The sandbox's Chromium moves with each Playwright release; /opt/pw-browsers/chromium follows it.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium" });
let over = 0;
for (const theme of ["light", "night"]) {
  const ctx = await browser.newContext({ viewport: { width: Number(process.env.AUDIT_W) || 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light" });
  await ctx.addCookies([{ name: "shot_as", value: as, domain: new URL(base).hostname, path: "/" }]);
  const page = await ctx.newPage();
  if (process.env.AUDIT_NOW) await page.clock.install({ time: new Date(process.env.AUDIT_NOW) });
  for (const route of routes) {
    const res = await page.goto(base + route, { waitUntil: "networkidle", timeout: 240_000 });
    // A badge's moment is not part of the screen: close it so the screen itself is measured.
    await page.evaluate(() => document.querySelectorAll(".celebrate, .celebrate-peek").forEach((el) => el.remove()));
    // Night is the 3 am screen. Force it on (or off) right before the shot, whatever the
    // clock says: the app's own night switch runs after load and would otherwise win.
    await page.evaluate((t) => (t === "night" ? document.documentElement.setAttribute("data-theme", "night") : document.documentElement.removeAttribute("data-theme")), theme);
    await page.waitForTimeout(300);
    const name = route === "/" ? "home" : route.slice(1).replace(/[/?=]/g, "_");
    await page.screenshot({ path: `${out}/${name}-${theme}.png`, fullPage: true });
    if (theme !== "light") continue;
    const measure = (scope) => page.evaluate((scope) => {
      const main = document.querySelector("main") ?? document.body;
      const shown = (el) => {
        const s = getComputedStyle(el);
        return s.display !== "none" && s.visibility !== "hidden" && el.getBoundingClientRect().height > 0;
      };
      const root = scope ? document.querySelector(scope) : null;
      // The screen's column: past the layout's single wrappers (PageSwap, the page's own
      // flex column) to where the blocks start. A plain layout box (flex, grid, gap and no
      // card of its own) inside the column holds blocks too: its children count, not it.
      const SURFACE = /\b(card|notice|fold|tile|row|bottom-action|page-header|segmented|log-card)/;
      const plain = (el) => (el.tagName === "DIV" || el.tagName === "SECTION") && !el.hasAttribute("data-block") && !SURFACE.test(typeof el.className === "string" ? el.className : "");
      let column = root ?? main;
      for (let kids = [...column.children].filter(shown); kids.length === 1 && plain(kids[0]); kids = [...column.children].filter(shown)) column = kids[0];
      const flatten = (el) => [...el.children].filter((c) => shown(c) && !c.classList.contains("grow-space")).flatMap((c) => (plain(c) && [...c.children].filter(shown).length > 1 ? flatten(c) : [c]));
      const box = root ?? main;
      const text = box.innerText;
      const wordsOf = (t) => t.split(/\s+/).filter(Boolean).length;
      const numbersOf = (t) => (t.match(/\b\d+(?:[.:]\d+)?\b/g) ?? []).length;
      // A closed select shows one of its options; innerText reads them all (Create another home
      // counted 468 words: 419 of them time zones in a menu nobody had opened). Count what shows.
      let words = wordsOf(text);
      let numbers = numbersOf(text);
      for (const sel of box.querySelectorAll("select")) {
        // Not one in a closed fold: it has a box, but innerText already leaves it out.
        if (!shown(sel) || !sel.checkVisibility()) continue;
        const seen = sel.selectedOptions[0]?.textContent ?? "";
        words -= wordsOf(sel.innerText) - wordsOf(seen);
        numbers -= numbersOf(sel.innerText) - numbersOf(seen);
      }
      return {
        blocks: flatten(column).length, // a spacer is not a block
        cards: [...box.querySelectorAll(".card, .tile, details, .action, .notice")].filter(shown).length,
        taps: [...box.querySelectorAll("a, button, summary")].filter(shown).length,
        numbers,
        words,
        screens: Math.round(((root ? root.getBoundingClientRect().height : document.documentElement.scrollHeight) / innerHeight) * 10) / 10,
      };
    }, scope);
    const ms = [];
    for (const [label, scope, b] of parts(route, new URL(page.url()).pathname)) ms.push([label, await measure(scope), b]);
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
      const label = (el) => (el.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
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
      // Home's log tiles stack on purpose (icon, name, two short lines): their name is checked, not the tile.
      const wrapped = all("button:not(.log-tile), .pill, .chip, th, dt, [role=tab], summary, .tile span, .action-label, .action-sub").filter((el) => {
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
        // A tick box or a radio inside its label: the label is what the finger meets.
        const target = el.tagName === "INPUT" && /^(checkbox|radio)$/.test(el.type) ? (el.closest("label") ?? el) : el;
        return target.getBoundingClientRect().height < 43.5;
      });
      // The wordmark is a logotype, a picture of letters: its small "el" is not text to read. Nothing else is let off.
      const tiny = all("*").filter((el) => !el.closest(".wordmark, .wordmark-ar") && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 13);
      // Not a check (a list row's detail is cut on purpose): the lines held on one line that end
      // in "…". AUDIT_CUT=1 prints them, to compare before and after a change to margins or type.
      const cut = all("*").filter((el) => {
        if (!(el instanceof HTMLElement)) return false; // an icon's <svg> clips too, and has no innerText
        const s = getComputedStyle(el);
        return /(hidden|clip)/.test(s.overflowX) && (s.whiteSpace === "nowrap" || s.textOverflow === "ellipsis") && label(el) && el.scrollWidth > el.clientWidth;
      });
      const pick = (els) => [...new Set(els.map(label).filter(Boolean))].slice(0, 4);
      return {
        wide: wide.length, sideways: sideways.length, tables: all("table").length, wrapped: wrapped.length, nested: nested.length, small: small.length, tiny: tiny.length,
        examples: { wrapped: pick(wrapped), nested: pick(nested), small: pick(small) },
        cut: cut.map((el) => `${JSON.stringify(label(el).slice(0, 40))} ${el.scrollWidth} px in ${el.clientWidth}`),
      };
    });
    const issues = Object.entries({ wide: phone.wide, sideways: phone.sideways, tables: phone.tables, "wrapped labels": phone.wrapped, "card in card": phone.nested, "small taps": phone.small, "tiny text": phone.tiny }).filter(([, n]) => n > 0);
    over += issues.length;
    for (const [label, m, b] of ms) {
      const broken = Object.keys(b).filter((k) => m[k] > b[k]).map((k) => `${k} ${m[k]} > ${b[k]}`);
      over += broken.length;
      console.log(`${label.padEnd(14)} ${res.status()}  blocks ${m.blocks}  cards ${m.cards}  taps ${m.taps}  numbers ${m.numbers}  words ${m.words}  screens ${m.screens}${broken.length ? `   OVER: ${broken.join(", ")}` : "   ok"}`);
    }
    console.log(`${"".padEnd(18)}phone: ${issues.length ? issues.map(([k, n]) => `${k} ${n}`).join(", ") : "ok"}`);
    for (const [k, v] of Object.entries(phone.examples)) if (v.length) console.log(`${"".padEnd(18)}  ${k}: ${v.map((t) => JSON.stringify(t)).join(", ")}`);
    if (process.env.AUDIT_CUT) for (const line of phone.cut) console.log(`${"".padEnd(18)}  cut: ${line}`);
  }
  await ctx.close();
}
await browser.close();
console.log(`\nScreenshots in ${out}. ${over ? `${over} budget(s) or phone check(s) broken.` : "Every screen within budget."}`);
