import type { Tint } from "@/components/Fold";
import type { IconName } from "@/components/Icon";

/** The feature colour for an entry type, by its key (feed, sleep, diaper, pump, meds…). */
export function tintFor(key: string | null | undefined): Tint {
  switch (key) {
    case "feed":
      return "feed";
    case "sleep":
    case "wake":
      return "sleep";
    case "diaper":
      return "diaper";
    case "pump":
      return "pump";
    case "meal":
      return "food";
    case "meds":
    case "medicine":
    case "medication":
    case "temp":
      return "meds";
    case "milk":
      return "milk";
    case "note":
      return "notes";
    case "activity":
      return "pump";
    case "growth":
      return "house";
    case "milestone":
      return "sleep";
    case "appointment":
      return "cal";
    default:
      return "guide";
  }
}

/**
 * The line icon for an entry type, the one Home's rows draw (DESIGN.md rule 9: the same thing
 * looks the same everywhere). Null for a type the family made up: its own emoji then.
 */
export function iconFor(key: string | null | undefined): IconName | null {
  switch (key) {
    case "feed":
      return "bottle";
    case "pump":
      return "droplet";
    case "diaper":
      return "diaper";
    case "sleep":
      return "zzz";
    case "wake":
      return "moon";
    case "meal":
      return "bowl";
    case "meds":
    case "medicine":
    case "medication":
      return "clock";
    case "temp":
      return "flame";
    case "note":
      return "note";
    case "growth":
      return "trend";
    case "milestone":
    case "activity":
      return "star";
    case "appointment":
      return "calendar";
    default:
      return null;
  }
}
