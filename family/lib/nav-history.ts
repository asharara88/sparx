/**
 * Where the person was a moment ago in the app (DESIGN.md: Back goes back). The tab bar
 * records each screen as it changes; a screen's Back arrow goes back in the browser's history
 * when the person came from another screen of the app, and to its own fallback when it was
 * opened from outside (a push, a shared link, the home-screen icon, a reload). Kept in memory
 * on purpose: a fresh load starts empty, so Back never leads out of the app.
 */
let now: string | null = null;
let prev: string | null = null;

export function notePath(path: string) {
  if (now === path) return;
  prev = now;
  now = path;
}

/** True when the screen before this one was another screen of the app, in this visit. */
export function cameFromApp(path: string): boolean {
  return now === path && prev != null && prev !== path;
}
