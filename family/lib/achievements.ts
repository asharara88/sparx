/**
 * Badges for what the family does (Mido, 9 November: "dopamine triggering motivation and award
 * winning badges for achievements on target and exceeding", for Dana and the rest, never for
 * Lana's own numbers). The database awards them (migration 5900, achievements_check); this
 * file only names them, says what each tier needs and what comes next. Pure: no "@/" imports,
 * so the unit tests load it on its own. Keep the needs in step with private.achievement_tiers().
 */

export type BadgeId = "pump_goal" | "pump_beat" | "stash";
export type Metal = "rose" | "bronze" | "silver" | "gold" | "diamond";

export interface Tier {
  tier: number;
  need: number;
  metal: Metal;
  /** "Gold", or the first one's own name. */
  name: string;
}

export interface Track {
  id: BadgeId;
  title: string;
  icon: "droplet" | "star" | "inbox";
  /** Whose: the pumping parent's, or the family's. */
  family: boolean;
  tiers: Tier[];
  /** What a tier says when won: "14 days on goal in a row". */
  says: (need: number) => string;
  /** The unit of progress, for "2 more days". */
  unit: (n: number) => string;
}

export const TRACKS: Track[] = [
  {
    id: "pump_goal",
    title: "On goal",
    icon: "droplet",
    family: false,
    tiers: [
      { tier: 1, need: 1, metal: "rose", name: "First goal" },
      { tier: 2, need: 3, metal: "bronze", name: "Bronze" },
      { tier: 3, need: 7, metal: "silver", name: "Silver" },
      { tier: 4, need: 14, metal: "gold", name: "Gold" },
      { tier: 5, need: 30, metal: "diamond", name: "Diamond" },
    ],
    says: (n) => (n === 1 ? "A day on the pumping goal" : `${n} days on goal in a row`),
    unit: (n) => `${n} more ${n === 1 ? "day" : "days"} in a row`,
  },
  {
    id: "pump_beat",
    title: "Beat the goal",
    icon: "star",
    family: false,
    tiers: [
      { tier: 1, need: 1, metal: "rose", name: "Over the top" },
      { tier: 2, need: 5, metal: "silver", name: "Silver" },
      { tier: 3, need: 15, metal: "gold", name: "Gold" },
    ],
    says: (n) => (n === 1 ? "A day well over the goal" : `${n} days well over the goal`),
    unit: (n) => `${n} more ${n === 1 ? "day" : "days"} over`,
  },
  {
    id: "stash",
    title: "Freezer stash",
    icon: "inbox",
    family: true,
    tiers: [
      { tier: 1, need: 500, metal: "bronze", name: "Half a litre" },
      { tier: 2, need: 1000, metal: "silver", name: "A litre saved" },
      { tier: 3, need: 2000, metal: "gold", name: "Two litres" },
    ],
    says: (n) => `${n >= 1000 ? `${n / 1000} litre${n === 1000 ? "" : "s"}` : `${n} ml`} in the freezer at once`,
    unit: (n) => `${n} ml`,
  },
];

export const track = (id: string): Track | undefined => TRACKS.find((t) => t.id === id);
export const tierOf = (id: string, tier: number): Tier | undefined => track(id)?.tiers.find((t) => t.tier === tier);

/** What the database measures (achievement_numbers). */
export interface BadgeNumbers {
  target: number | null;
  goal_from: number;
  today_ml: number;
  best_run: number;
  current_run: number;
  beat_days: number;
  freezer_ml: number;
}

/** The celebration's headline: "Gold!" and its line: "14 days on goal in a row". */
export function headline(id: string, tier: number): { title: string; line: string } {
  const t = track(id);
  const x = tierOf(id, tier);
  if (!t || !x) return { title: "Well done!", line: "" };
  return { title: `${x.name}!`, line: t.says(x.need) };
}

/**
 * The next tier of a track and how far there is to go, or null when every tier is won.
 * Pumping runs count from the run still going, so "2 more days" means two more days in a row.
 */
export function nextUp(id: BadgeId, n: BadgeNumbers, won: number[]): { tier: Tier; have: number; left: number } | null {
  const t = track(id);
  if (!t) return null;
  const next = t.tiers.find((x) => !won.includes(x.tier));
  if (!next) return null;
  const have = id === "pump_goal" ? n.current_run : id === "pump_beat" ? n.beat_days : n.freezer_ml;
  return { tier: next, have, left: Math.max(0, next.need - have) };
}

/**
 * Home's nudge for the pumping parent while a run is going and today is not on goal yet:
 * "190 ml more today keeps your 4-day run". Null when there is nothing to keep.
 */
export function keepRun(n: BadgeNumbers): string | null {
  if (!n.target || n.current_run < 1 || n.today_ml >= n.goal_from) return null;
  return `${n.goal_from - n.today_ml} ml more today keeps your ${n.current_run}-day run`;
}
