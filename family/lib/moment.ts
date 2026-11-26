/**
 * The small moment a save earns (Mido, 26 November: a reward on every log, not only the rare
 * medal): a soft buzz the instant it is saved, and a tick that fills on the screen
 * (components/SavedTick.tsx). Nothing to dismiss and nothing in the way at 3 am.
 *
 * The buzz is skipped for someone who asked for less motion, and a phone that cannot buzz
 * stays still: the web cannot on an iPhone, where the tick is the whole moment. It never
 * throws: a reward must not be able to break a save. No "@/" imports, so the node test runner
 * and lib/offline.ts can load it.
 */
export function buzz(pattern: number | number[] = 18): void {
  try {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    navigator.vibrate?.(pattern);
  } catch {
    /* no vibration on this phone */
  }
}
