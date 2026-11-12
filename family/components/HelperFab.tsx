"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "@/lib/me-context";
import { can, type HomeSummary, type RpcError } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { quickContextOf, type QuickContext } from "@/lib/assistant/quick-context";
import { Assistant } from "./Assistant";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { fabLift, type Box } from "@/lib/fab-place";

const MAX_LIFT = 160;
const CONTROLS = "button, summary, input, select, textarea, [role=button], .chip, .pill, .btn, img, svg";

/**
 * What the button must not sit on, in the column above it: every line of words, every icon,
 * and every control narrower than the screen's column. A link or row that spans the column is
 * a container: its words and icons count, the empty space beside them does not.
 */
function contentBoxes(base: Box, maxLift: number): Box[] {
  const main = document.querySelector("main");
  if (!main) return [];
  const zone = { top: base.top - maxLift - 8, bottom: base.bottom + 8, left: base.left - 8, right: base.right + 8 };
  const inZone = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > zone.top && r.top < zone.bottom && r.right > zone.left && r.left < zone.right;
  const wide = main.getBoundingClientRect().width * 0.7;
  const out: Box[] = [];
  // Only what is really on screen: a fold's hidden rows still have boxes, clipped away.
  const seen = (el: Element, r: DOMRect) => {
    const at = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1));
    return !!at && (el === at || el.contains(at));
  };
  const keep = (r: DOMRect) => out.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  for (const el of main.querySelectorAll(CONTROLS)) {
    const r = el.getBoundingClientRect();
    if (inZone(r) && r.width < wide && !el.closest("nav, .helper-fab") && seen(el, r)) keep(r);
  }
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim()) continue;
    const box = n.parentElement?.getBoundingClientRect();
    if (!box || !inZone(box)) continue; // skip the text far from the button cheaply
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (inZone(r) && seen(n.parentElement!, r)) keep(r);
  }
  return out;
}

/** The helper's own screens, and Home (its "Tell me" is already in the log card), carry no button. */
const NOT_HERE = [/^\/$/, /^\/ask(\/|$)/, /^\/chat(\/|$)/];

/** Which screen the question came from, as the helper's prompt knows them (app/api/assistant). */
function screenOf(path: string): string | null {
  if (path.startsWith("/baby/milk")) return "milk";
  if (path.startsWith("/baby")) return "child";
  if (path.startsWith("/calendar")) return "calendar";
  return null;
}

/**
 * The helper from any screen (Mido, 12 November: "a floating button to chat with the helper
 * from any screen"): a round button above the tab bar, on the right, that opens the helper in
 * a sheet over the screen, so the screen stays where it was. Plain logs are saved at once
 * there too: the child's quick context is fetched when the sheet opens. Hidden while a sheet
 * is open or the keyboard is up (globals.css), and moved up clear of a screen's bottom button.
 */
export function HelperFab() {
  const me = useMe();
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState<number | null>(null);
  const [quick, setQuick] = useState<QuickContext | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const hidden = !can(me, "assistant", "view") || NOT_HERE.some((r) => r.test(path));
  // The button lives in the app's layout and outlives a screen: an answer's link (an entry,
  // the calendar) moves to another screen, and the sheet must close with it, or it would cover
  // the new screen and keep it from scrolling.
  const lastPath = useRef(path);
  useEffect(() => {
    if (lastPath.current === path) return;
    lastPath.current = path;
    setOpen(null);
  }, [path]);
  // Where the button rests. A screen's own bottom button (Milk's "Put a bottle away") wins the
  // spot: the helper's button moves up just enough to clear it. Then it slides up to the
  // nearest spot where it covers nothing a person reads or taps (a row's amount, "Send an
  // invite link"), up to 160 px; with no clear spot in reach it stays where it is. Measured when
  // the screen settles and when scrolling stops, so it never jumps about under a moving thumb.
  useEffect(() => {
    let raf = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const place = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const fab = ref.current;
        if (!fab) return;
        fab.style.removeProperty("--fab-lift");
        const f = fab.getBoundingClientRect();
        if (!f.height) return;
        let lift = 0;
        const act = document.querySelector(".bottom-action");
        const a = act?.getBoundingClientRect();
        if (a && a.height && a.bottom > f.top - 8 && a.top < f.bottom + 8) lift = Math.round(f.bottom - a.top + 12);
        const base = { top: f.top - lift, bottom: f.bottom - lift, left: f.left, right: f.right };
        fab.style.pointerEvents = "none";
        lift += fabLift(base, contentBoxes(base, MAX_LIFT), MAX_LIFT);
        fab.style.removeProperty("pointer-events");
        if (lift) fab.style.setProperty("--fab-lift", `${lift}px`);
      });
    };
    const onScroll = () => {
      clearTimeout(idle);
      idle = setTimeout(place, 120);
    };
    const settle = setTimeout(place, 300);
    place();
    // The screen keeps arriving after the button mounts (a skeleton, then the page, then a
    // fold opened): measure again once it stops changing.
    const main = document.querySelector("main");
    const watch = new MutationObserver(onScroll);
    if (main) watch.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      clearTimeout(settle);
      clearTimeout(idle);
      watch.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", place);
    };
    // Again once the button is there: on the first render it may not be yet.
  }, [path, hidden]);
  if (hidden) return null;

  const show = () => {
    setOpen((n) => (n ?? 0) + 1);
    if (can(me, "lana", "add") && (me.subjects?.length ?? 1) <= 1) {
      // Offline or refused: no quick logs, and the helper still answers.
      supabaseBrowser()
        .rpc("home_summary")
        .then(
          ({ data }: { data: unknown }) => setQuick(quickContextOf(data as HomeSummary | RpcError | null, me)),
          () => setQuick(null),
        );
    }
  };

  return (
    <>
      <button ref={ref} type="button" className="helper-fab" aria-label="Ask the helper" onClick={show}>
        <Icon name="sparkles" size={26} />
      </button>
      {open != null && (
        <Sheet title="Helper" fill onClose={() => setOpen(null)}>
          <Assistant key={open} embedded suggestions={[]} quick={quick} screen={screenOf(path)} />
          <Link prefetch={false} href="/ask" className="muted shrink-0 self-end text-sm font-semibold" onClick={() => setOpen(null)}>
            Open the full chat ›
          </Link>
        </Sheet>
      )}
    </>
  );
}
