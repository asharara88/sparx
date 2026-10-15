/**
 * Entry checks: the log's own sanity. A timer left running, a sleep that
 * "lasted" through three feeds, two nappies logged in the same minute, a
 * 400 ml bottle: these are mis-entries, not facts, and they poison every
 * number the app and the helper quote. The checks find them and suggest the
 * fix the data itself supports (end a timer where the next entry proves she
 * was awake, cap a feed at a normal length, drop a double tap). Nothing is
 * changed until someone taps. Pure, so it is unit-tested; the same rules run
 * for the imported history and for what is logged today.
 */

export interface CheckEntry {
  id: string;
  type_id: string;
  occurred_at: string;
  ended_at: string | null;
  payload: Record<string, unknown>;
}

export type CheckKind = "long_feed" | "long_sleep" | "overlap" | "open_timer" | "double" | "big_bottle" | "short_timer";

export interface CheckFlag {
  id: string;
  kind: CheckKind;
  /** The entry in question. */
  entry: CheckEntry;
  title: string;
  detail: string;
  /** The fix the data supports; null when the only honest options are "it was real" or delete. */
  fix: { label: string; ended_at: string } | null;
  /** True when deleting is the likely right answer (a double tap, a one-second timer). */
  suggestDelete: boolean;
}

export interface CheckOptions {
  now?: number;
  /** A normal breastfeed, minutes; feeds past LONG_FEED_MIN are capped to this. */
  keepFeedMin?: number;
}

export const LONG_FEED_MIN = 45;
export const KEEP_FEED_MIN = 20;
export const LONG_SLEEP_HOURS = 10;
export const OPEN_SLEEP_HOURS = 12;
export const OPEN_FEED_MIN = 45;
export const OPEN_WAKE_HOURS = 3;
export const BIG_BOTTLE_ML = 240;
export const DOUBLE_WINDOW_MIN = 2;
export const SHORT_TIMER_SEC = 45;

const t = (iso: string) => Date.parse(iso);
const minutes = (ms: number) => Math.round(ms / 60_000);
const hm = (ms: number) => {
  const m = minutes(ms);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${m} min`;
};
const kind = (e: CheckEntry) => e.type_id.slice(e.type_id.indexOf(".") + 1);
const checked = (e: CheckEntry) => e.payload.checked === true || e.payload.timer_ok === true || e.payload.timer_capped === true;

/** Feeds and sleeps are timers; a later feed, nappy or sleep proves the earlier one had ended by then. */
function isTimer(e: CheckEntry): boolean {
  const k = kind(e);
  if (k === "feed") return e.payload.method !== "Bottle"; // bottles are logged after the fact, with no timer
  return k === "sleep" || k === "wake";
}

export function checkEntries(input: CheckEntry[], opts: CheckOptions = {}): CheckFlag[] {
  const now = opts.now ?? Date.now();
  const keep = opts.keepFeedMin ?? KEEP_FEED_MIN;
  const entries = [...input].sort((a, b) => t(a.occurred_at) - t(b.occurred_at));
  const flags: CheckFlag[] = [];
  const flagged = new Set<string>();
  const push = (f: Omit<CheckFlag, "id">) => {
    if (flagged.has(f.entry.id)) return;
    flagged.add(f.entry.id);
    flags.push({ id: `${f.kind}:${f.entry.id}`, ...f });
  };

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const k = kind(e);
    const start = t(e.occurred_at);
    const end = e.ended_at ? t(e.ended_at) : null;

    // 1. A timer that is still running far too long.
    if (isTimer(e) && end == null && !checked(e)) {
      const ran = now - start;
      const limit = k === "feed" ? OPEN_FEED_MIN * 60_000 : k === "sleep" ? OPEN_SLEEP_HOURS * 3_600_000 : OPEN_WAKE_HOURS * 3_600_000;
      if (ran > limit) {
        const next = entries.slice(i + 1).find((x) => x.id !== e.id && t(x.occurred_at) > start + 60_000);
        const endAt = next ? next.occurred_at : k === "feed" ? new Date(start + keep * 60_000).toISOString() : null;
        push({
          kind: "open_timer",
          entry: e,
          title: k === "feed" ? "Feed timer still running" : k === "sleep" ? "Sleep timer still running" : "Night wake still open",
          detail: `Started ${hm(ran)} ago and never ended.${next ? ` The next thing logged was at ${next.occurred_at}, so it had ended by then.` : ""}`,
          fix: endAt ? { label: next ? "End it at the next entry" : `End it at ${keep} min`, ended_at: endAt } : null,
          suggestDelete: false,
        });
        continue;
      }
    }

    // 2. A one-second timer: a tap by mistake.
    if (isTimer(e) && end != null && end - start < SHORT_TIMER_SEC * 1000 && !checked(e)) {
      push({ kind: "short_timer", entry: e, title: `${k === "feed" ? "Feed" : k === "sleep" ? "Sleep" : "Wake"} of ${Math.round((end - start) / 1000)} seconds`, detail: "Almost always a tap by mistake.", fix: null, suggestDelete: true });
      continue;
    }

    // 3. A timer that ran across later entries: she was logged awake (or fed) while it ran.
    if (isTimer(e) && end != null && !checked(e)) {
      const during = entries.slice(i + 1).filter((x) => t(x.occurred_at) > start + 10 * 60_000 && t(x.occurred_at) < end - 10 * 60_000 && !(k === "sleep" && kind(x) === "wake"));
      if (during.length) {
        const first = during[0];
        push({
          kind: "overlap",
          entry: e,
          title: `${k === "feed" ? "Feed" : "Sleep"} of ${hm(end - start)} with ${during.length} ${during.length === 1 ? "entry" : "entries"} logged during it`,
          detail: `A ${kind(first)} was logged at ${first.occurred_at}, ${hm(t(first.occurred_at) - start)} in, so the timer was probably left on.`,
          fix: { label: "End it at that entry", ended_at: first.occurred_at },
          suggestDelete: false,
        });
        continue;
      }
    }

    // 4. Plainly too long.
    if (k === "feed" && end != null && e.payload.method === "Breast" && !checked(e) && end - start > LONG_FEED_MIN * 60_000) {
      push({ kind: "long_feed", entry: e, title: `Feed of ${hm(end - start)}`, detail: "Longer than a normal feed; the timer was probably left on.", fix: { label: `Trim to ${keep} min`, ended_at: new Date(start + keep * 60_000).toISOString() }, suggestDelete: false });
      continue;
    }
    if (k === "sleep" && end != null && !checked(e) && end - start > LONG_SLEEP_HOURS * 3_600_000) {
      push({ kind: "long_sleep", entry: e, title: `Sleep of ${hm(end - start)}`, detail: `Over ${LONG_SLEEP_HOURS} hours in one go is rare; was the timer left on?`, fix: null, suggestDelete: false });
      continue;
    }

    // 5. Doubles: the same kind twice within two minutes.
    const prev = entries[i - 1];
    if (prev && kind(prev) === k && !isTimer(e) && start - t(prev.occurred_at) <= DOUBLE_WINDOW_MIN * 60_000 && !checked(e)) {
      push({ kind: "double", entry: e, title: `Two ${k === "diaper" ? "nappies" : `${k} entries`} within ${DOUBLE_WINDOW_MIN} minutes`, detail: `One at ${prev.occurred_at} and this one. A double tap, or two real ones?`, fix: null, suggestDelete: true });
      continue;
    }

    // 6. An amount that is not a baby's bottle.
    if (k === "feed" && Number(e.payload.amount_ml) > BIG_BOTTLE_ML && !checked(e)) {
      push({ kind: "big_bottle", entry: e, title: `Bottle of ${Number(e.payload.amount_ml)} ml`, detail: `Over ${BIG_BOTTLE_ML} ml in one bottle is unusual at this age. A typo?`, fix: null, suggestDelete: false });
    }
  }
  return flags;
}
