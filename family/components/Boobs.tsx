"use client";
import { useState } from "react";

/**
 * Two breasts you tap. Left starts the left side, right starts the right.
 * While feeding, the active one glows, drips and shows the stopwatch; tapping
 * it finishes, tapping the other one switches side. The side that is "due"
 * (opposite to the last feed) wears a little tag so Dana never has to remember.
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
        const label = isActive ? `${side} feeding, ${elapsed ?? ""}. Tap to finish.` : isOther ? `Switch to ${side.toLowerCase()}` : `Start ${side.toLowerCase()} side`;
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
            <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden focusable="false">
              <defs>
                <radialGradient id={`skin-${side}`} cx="40%" cy="35%" r="70%">
                  <stop offset="0%" stopColor="#ffe3d3" />
                  <stop offset="60%" stopColor="#f6c4a8" />
                  <stop offset="100%" stopColor="#e2a184" />
                </radialGradient>
                <radialGradient id={`glow-${side}`} cx="50%" cy="50%" r="50%">
                  <stop offset="70%" stopColor="#60a5fa" stopOpacity="0" />
                  <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.55" />
                </radialGradient>
              </defs>
              {isActive && <circle className="boob-halo" cx="60" cy="62" r="58" fill={`url(#glow-${side})`} />}
              <ellipse cx="60" cy="112" rx="40" ry="5" fill="#000" opacity="0.08" />
              <circle cx="60" cy="62" r="50" fill={`url(#skin-${side})`} />
              {/* areola + nipple sit a touch toward the outside, like the real thing */}
              <g transform={`translate(${side === "Left" ? -4 : 4} 8)`}>
                <circle cx="60" cy="62" r="15" fill="#d9907c" opacity="0.9" />
                <circle cx="60" cy="62" r="6.5" fill="#c4705f" />
                <circle cx="58" cy="60" r="1.8" fill="#fff" opacity="0.6" />
                {isActive && (
                  <g className="boob-drip">
                    <path d="M60 70 q-4 7 0 11 q4 -4 0 -11z" fill="#fff" opacity="0.95" />
                    <path className="boob-drip-2" d="M60 70 q-4 7 0 11 q4 -4 0 -11z" fill="#fff" opacity="0.8" />
                  </g>
                )}
              </g>
              <ellipse cx="44" cy="38" rx="12" ry="7" transform="rotate(-30 44 38)" fill="#fff" opacity="0.35" />
            </svg>
            <span className="boob-label">
              {isActive ? (
                <span className="tabular-nums">{elapsed}</span>
              ) : (
                <>
                  {side}
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
