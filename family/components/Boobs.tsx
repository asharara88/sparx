"use client";
import { useState } from "react";

/**
 * Two boobs you tap, named "Left boob" and "Right boob". Left starts the left side, right the right.
 * While feeding, the active one glows, sends out little rays and shows the stopwatch;
 * tapping it finishes, tapping the other one switches side. The side that is "due"
 * (opposite to the last feed) wears a little tag so the mother never has to remember.
 */
export function Boobs({
  active,
  elapsed,
  suggested,
  counts,
  disabled,
  onTap,
}: {
  active: "Left" | "Right" | null;
  elapsed: string | null;
  suggested: "Left" | "Right" | null;
  counts: { Left: number; Right: number };
  disabled: boolean;
  onTap: (side: "Left" | "Right") => void;
}) {
  const [squish, setSquish] = useState<"Left" | "Right" | null>(null);
  const tap = (side: "Left" | "Right") => {
    setSquish(side);
    setTimeout(() => setSquish(null), 450);
    onTap(side);
  };
  return (
    <div className="grid grid-cols-2 gap-3" role="group" aria-label="Breastfeed">
      {(["Left", "Right"] as const).map((side) => {
        const isActive = active === side;
        const isOther = active !== null && !isActive;
        const label = isActive ? `${side} boob feeding, ${elapsed ?? ""}. Tap to finish.` : isOther ? `Switch to ${side.toLowerCase()} boob` : `Start ${side.toLowerCase()} boob`;
        return (
          <button
            key={side}
            type="button"
            aria-label={label}
            aria-pressed={isActive}
            disabled={disabled}
            onClick={() => tap(side)}
            className={`boob ${isActive ? "boob-active" : ""} ${squish === side ? "boob-squish" : ""} ${suggested === side && !active ? "boob-next" : ""}`}
          >
            {/* A flat, friendly line drawing in the theme's own colours: a soft round shape
                hanging from the chest line (open at the top), the nipple a touch toward the
                outside, and three little rays when that side is feeding. The right one is
                the left one mirrored. */}
            <svg viewBox="0 0 120 110" className="h-full w-full" aria-hidden focusable="false">
              <g transform={side === "Right" ? "translate(120 0) scale(-1 1)" : undefined}>
                <path
                  d="M24 22 A46 46 0 1 0 96 22"
                  fill="var(--apricot-soft)"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="54" cy="64" r="15" fill="var(--accent)" opacity={isActive ? 1 : 0.55} />
                <circle cx="54" cy="64" r="5.5" fill="currentColor" opacity="0.6" />
                {isActive && (
                  <g className="boob-rays" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" fill="none">
                    <path d="M54 42 v-9" />
                    <path d="M37 48 l-6 -6" />
                    <path d="M71 48 l6 -6" />
                  </g>
                )}
              </g>
            </svg>
            <span className="boob-label">
              {isActive ? (
                <span className="tabular-nums">{elapsed}</span>
              ) : (
                <>
                  {side} boob
                  {counts[side] > 0 && (
                    <span className="boob-count" aria-label={`${counts[side]} today`}>
                      {" "}
                      {"•".repeat(Math.min(counts[side], 8))}
                    </span>
                  )}
                </>
              )}
            </span>
            {suggested === side && !active && <span className="boob-tag">next</span>}
            {isActive && <span className="boob-tag boob-tag-active">tap to finish</span>}
            {isOther && <span className="boob-tag">switch</span>}
          </button>
        );
      })}
    </div>
  );
}
