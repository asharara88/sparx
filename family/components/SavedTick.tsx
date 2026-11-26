/**
 * The tick that fills when something is saved (lib/moment.ts): a ring that closes and a check
 * drawn into it, in about a third of a second, beside the words that say what was saved. It
 * is drawn once, when it appears; give it a new `key` to play it again for the next save.
 * Still (already full) for someone who asked for less motion. A picture, not text: the words
 * beside it are what a screen reader hears.
 */
export function SavedTick({ size = 22 }: { size?: number }) {
  return (
    <svg className="saved-tick" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M7.5 12.5l3 3 6-6.5" />
    </svg>
  );
}
