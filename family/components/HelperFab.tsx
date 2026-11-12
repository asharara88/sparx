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
  // A screen's own bottom button (Milk's "Put a bottle away") wins the spot: wherever it is,
  // held at the bottom while the page scrolls or sitting mid-screen on a short page, the
  // helper's button moves up just enough to clear it, and back down once it is gone.
  useEffect(() => {
    let raf = 0;
    const place = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const fab = ref.current;
        if (!fab) return;
        fab.style.removeProperty("--fab-lift");
        const act = document.querySelector(".bottom-action");
        if (!act) return;
        const a = act.getBoundingClientRect();
        const f = fab.getBoundingClientRect();
        if (a.height && a.bottom > f.top - 8 && a.top < f.bottom + 8) fab.style.setProperty("--fab-lift", `${Math.round(f.bottom - a.top + 12)}px`);
      });
    };
    const settle = setTimeout(place, 300);
    place();
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      clearTimeout(settle);
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [path]);
  if (!can(me, "assistant", "view") || NOT_HERE.some((r) => r.test(path))) return null;

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
