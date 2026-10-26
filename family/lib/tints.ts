import type { Tint } from "@/components/Fold";

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
    case "meds":
    case "medicine":
    case "temp":
      return "meds";
    case "milk":
      return "milk";
    default:
      return "guide";
  }
}
