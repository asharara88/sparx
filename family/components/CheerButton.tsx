"use client";
import { useState } from "react";
import { CheerSheet, type CheerTarget } from "./CheerSheet";

/**
 * A door to a cheer: a plain text button on a line that already names what someone did (a
 * medal on the shelf, who saved an entry). It opens the cheer sheet; nothing is sent by the
 * tap itself. The line it sits on decides how it looks (`className`) and what it says.
 */
export function CheerButton({ target, children = "Cheer", className = "min-h-[44px] px-2 font-semibold text-[var(--accent)]" }: { target: CheerTarget; children?: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && <CheerSheet target={target} onClose={() => setOpen(false)} />}
    </>
  );
}
