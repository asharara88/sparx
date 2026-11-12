"use client";
import { useState } from "react";
import Link from "next/link";
import type { QuickContext } from "@/lib/assistant/quick-context";
import { Assistant } from "./Assistant";
import { SayIt } from "./SayIt";
import { Sheet } from "./Sheet";

/**
 * "Tell me" at the bottom of Home's log card (Mido, 9 November: the helper is becoming the
 * main way to log). Tap the box to type, or the mic to say it: the helper opens in a sheet
 * over Home, so Home stays underneath. Plain logs ("120 ml bottle", "wet nappy") are saved on
 * the phone at once with Undo (lib/assistant/quick-log.ts); anything else goes to the helper.
 */
export function TellBar({ quick }: { quick: QuickContext | null }) {
  const [open, setOpen] = useState<{ said: string | null; n: number } | null>(null);
  const show = (said: string | null) => setOpen((o) => ({ said, n: (o?.n ?? 0) + 1 }));
  return (
    <>
      <div className="tell-bar">
        <button type="button" className="tell-box" onClick={() => show(null)}>
          Tell me what happened…
        </button>
        <SayIt icon onHeard={(t) => show(t)} />
      </div>
      {open && (
        <Sheet title="Tell me" fill onClose={() => setOpen(null)}>
          <Assistant key={open.n} embedded suggestions={[]} quick={quick} autoAsk={open.said} screen="home" />
          <Link prefetch={false} href="/ask" className="muted shrink-0 self-end text-sm font-semibold">
            Open the full chat ›
          </Link>
        </Sheet>
      )}
    </>
  );
}
