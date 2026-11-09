import type { Metal } from "@/lib/achievements";
import { Icon } from "./Icon";

// Each metal: the disc's light and dark, the ribbon's two colours.
const METAL: Record<Metal, { hi: string; lo: string; rim: string; ribbon: [string, string] }> = {
  rose: { hi: "#ffd3df", lo: "#c2476a", rim: "#9e2f52", ribbon: ["#e86f92", "#b33a5e"] },
  bronze: { hi: "#f6c592", lo: "#a5602c", rim: "#7c431b", ribbon: ["#d9843f", "#a5602c"] },
  silver: { hi: "#ffffff", lo: "#9aa4b1", rim: "#6f7884", ribbon: ["#7f95b8", "#566b8f"] },
  gold: { hi: "#fff1b0", lo: "#d39b12", rim: "#9a6f05", ribbon: ["#e0485f", "#b02a40"] },
  diamond: { hi: "#f2fbff", lo: "#6cc3ee", rim: "#2c86b8", ribbon: ["#8a6fe0", "#5d43b8"] },
};

/**
 * A medal: ribbon, a metal disc with a rim, the track's icon in the middle. Locked medals
 * (not won yet) are a grey outline, so the shelf shows what is still to win.
 */
export function Medal({ metal, icon, size = 72, locked = false, label }: { metal: Metal; icon: "droplet" | "star" | "inbox"; size?: number; locked?: boolean; label?: string }) {
  const m = METAL[metal];
  const id = `m-${metal}-${locked ? "l" : "w"}`;
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size * 1.25 }} role="img" aria-label={label}>
      <svg viewBox="0 0 80 100" width={size} height={size * 1.25} aria-hidden="true" style={locked ? { filter: "grayscale(1)", opacity: 0.35 } : undefined}>
        <defs>
          <radialGradient id={`${id}-g`} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor={m.hi} />
            <stop offset="100%" stopColor={m.lo} />
          </radialGradient>
        </defs>
        <path d="M22 0h14l10 34H32z" fill={m.ribbon[0]} />
        <path d="M44 0h14L48 34H34z" fill={m.ribbon[1]} />
        <circle cx="40" cy="62" r="34" fill={m.rim} />
        <circle cx="40" cy="62" r="30" fill={`url(#${id}-g)`} />
        <circle cx="40" cy="62" r="24" fill="none" stroke={m.rim} strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="2 3" />
        {metal === "diamond" && <path d="M28 50l12-8 12 8-12 26z" fill="#ffffff" fillOpacity="0.35" />}
      </svg>
      <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ top: `${(62 / 100) * 100}%`, color: locked ? "var(--muted)" : m.rim, opacity: locked ? 0.6 : 1 }}>
        <Icon name={icon} size={Math.round(size * 0.32)} />
      </span>
    </span>
  );
}
