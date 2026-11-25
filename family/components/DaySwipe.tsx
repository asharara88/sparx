"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * A swipe across a section's screen goes to the day before or after (DESIGN.md, "Day pager"):
 * a finger moving right brings the day before, as turning back a page. The pager's arrows do
 * the same, so nothing depends on finding the gesture. Left alone: a touch that starts at the
 * screen's edge (the phone's own back gesture), in a field, or while a sheet is open; a slow
 * drag; and anything more up-and-down than sideways (that is scrolling).
 */
export function DaySwipe({ prev, next }: { prev: string | null; next: string | null }) {
  const router = useRouter();
  useEffect(() => {
    let x0 = 0;
    let y0 = 0;
    let t0 = 0;
    let live = false;
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      const on = e.target instanceof Element ? e.target : null;
      live = e.touches.length === 1 && t.clientX > 24 && t.clientX < window.innerWidth - 24 && !document.documentElement.classList.contains("sheet-open") && !on?.closest("input, textarea, select, [contenteditable]");
      x0 = t.clientX;
      y0 = t.clientY;
      t0 = Date.now();
    };
    const end = (e: TouchEvent) => {
      if (!live) return;
      live = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      if (Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy) || Date.now() - t0 > 700) return;
      const to = dx > 0 ? prev : next;
      if (to) router.replace(to); // a step on the same screen: Back still leaves it in one tap (DayPager.tsx)
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    // Chrome treats a sideways drag on a page that cannot scroll sideways as its own "back":
    // it would leave the app before this handler is heard. Off while a section is open.
    const root = document.documentElement;
    const before = root.style.overscrollBehaviorX;
    root.style.overscrollBehaviorX = "none";
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchend", end);
      root.style.overscrollBehaviorX = before;
    };
  }, [prev, next, router]);
  return null;
}
