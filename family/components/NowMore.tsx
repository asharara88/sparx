"use client";
import { useState } from "react";
import { Sheet } from "./Sheet";

/**
 * "More" beside Home's one notice (DESIGN.md, "Home", item 4): opens every notice that
 * applies now in a sheet over Home, one under the other. Until 24 November this was "+2", a
 * link to the child's screen, which did not show the two things it counted.
 */
export function NowMore({ count, children }: { /** How many wait behind the one that shows. */ count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="now-more" aria-haspopup="dialog" aria-label={`${count} more to look at`} onClick={() => setOpen(true)}>
        More
      </button>
      {open && (
        <Sheet title="To look at" onClose={() => setOpen(false)}>
          <div className="look-list">{children}</div>
        </Sheet>
      )}
    </>
  );
}
