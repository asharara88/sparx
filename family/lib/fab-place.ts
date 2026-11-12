/**
 * Where the helper's round button rests (components/HelperFab.tsx). It floats over the screen,
 * so left alone it sits on whatever is under it: a row's amount, "Send an invite link",
 * "Create the home". Given the button's resting box and the boxes of what must stay visible
 * (words, icons, buttons), this says how far up to slide it to the nearest clear spot.
 */
export type Box = { top: number; bottom: number; left: number; right: number };

const hits = (a: Box, b: Box, gap: number) => a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;

/**
 * The smallest lift (px, 0 or more) that leaves `gap` px clear around the button, searching up
 * to `maxLift`. A screen with no clear spot in reach (a long list, edge to edge) gets 0: the
 * button stays home rather than wander up the screen.
 */
export function fabLift(base: Box, obstacles: Box[], maxLift: number, gap = 6): number {
  const near = obstacles.filter((o) => o.right > base.left - gap && o.left < base.right + gap);
  let lift = 0;
  // Each pass jumps just clear of the lowest thing in the way; anything it then lands on is
  // cleared by the next pass, so the answer is the lowest clear spot.
  for (let i = 0; i <= near.length; i++) {
    const at = { ...base, top: base.top - lift, bottom: base.bottom - lift };
    const blocking = near.filter((o) => hits(at, o, gap));
    if (!blocking.length) return lift;
    lift = base.bottom - Math.min(...blocking.map((o) => o.top)) + gap;
    if (lift > maxLift) return 0;
  }
  return 0;
}
