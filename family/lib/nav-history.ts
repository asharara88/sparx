/**
 * The screens the person has walked through in the app, in this visit (DESIGN.md: Back goes
 * back). The tab bar records each screen as it changes; a screen's Back arrow goes back in the
 * browser's history only while an app screen lies behind it in this stack, and to its own
 * fallback otherwise: opened from outside (a push, a shared link, the home-screen icon, a
 * reload), or back at the screen the visit started on. Kept in memory on purpose: a fresh load
 * starts empty, so Back never leads out of the app.
 */
const stack: string[] = [];

export function notePath(path: string) {
  if (stack[stack.length - 1] === path) return;
  // Arriving at the screen just under the top is a step back: drop the one we left.
  if (stack.length >= 2 && stack[stack.length - 2] === path) stack.pop();
  else stack.push(path);
}

/** True when another screen of the app lies behind this one in the visit. */
export function cameFromApp(path: string): boolean {
  return stack.length >= 2 && stack[stack.length - 1] === path;
}
