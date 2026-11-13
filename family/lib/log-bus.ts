/**
 * The bar's ＋ and the log sheet (DESIGN.md, "The bottom bar"). A screen that holds the log
 * sheet (Home, the child's page) opens it in place, so ＋ never moves the person; any other
 * screen goes to the child's page with ?log=1, and closing the sheet there goes back.
 */
const EVENT = "elnunu:log";
const FROM = "elnunu:log-from";
let mounted = 0;

/** A LogMenu on screen: ＋ opens it here. Returns the cleanup. */
export function onLogHere(open: () => void): () => void {
  mounted++;
  window.addEventListener(EVENT, open);
  return () => {
    mounted--;
    window.removeEventListener(EVENT, open);
  };
}

/** ＋ tapped: true when a sheet on this screen took it. */
export function openLogHere(): boolean {
  if (!mounted) return false;
  window.dispatchEvent(new Event(EVENT));
  return true;
}

/** ＋ tapped on a screen without the sheet: remember to come back when it closes. */
export function markLogFrom(path: string) {
  try {
    sessionStorage.setItem(FROM, JSON.stringify({ path, at: Date.now() }));
  } catch {
    /* private mode: the sheet just stays on the child's page */
  }
}

/**
 * The sheet opened from ?log=1: was it the bar's ＋ on another screen, a moment ago? Reads once.
 * A mark older than a minute is stale (the tap never arrived), so a link opened later never
 * sends the person "back" out of the app.
 */
export function takeLogFrom(now = Date.now()): boolean {
  try {
    const raw = sessionStorage.getItem(FROM);
    sessionStorage.removeItem(FROM);
    if (!raw) return false;
    const { at } = JSON.parse(raw) as { at?: number };
    return typeof at === "number" && now - at >= 0 && now - at < 60_000;
  } catch {
    return false;
  }
}
