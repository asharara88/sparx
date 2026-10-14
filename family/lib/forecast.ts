import type { EntryRow } from "@/lib/types";

/**
 * Lana's next 12 hours, estimated from her last 7 days. Nothing here is logged:
 * it is a plan to glance at ("a feed around 15:10, a nap around 16:00").
 *
 * Feeds: the median gap between feeds over the last week, bounded to 1.5–4 h,
 * measured separately for the hours Mama is at work (bottles come closer
 * together) and the rest of the day. Nappies: median gap. Sleeps: median nap
 * length and median awake window. Each falls back to a sensible default when
 * there are fewer than three samples.
 */

const H = 3_600_000;
const MIN = 60_000;

export interface ForecastItem {
  kind: "feed" | "diaper" | "sleep" | "wake";
  /** Epoch ms. */
  at: number;
  /** True when the estimate is already in the past: "due now". */
  due: boolean;
}

export interface ForecastOptions {
  now?: number;
  /** How far ahead, in hours. */
  hours?: number;
  /** True when, at that instant, the breastfeeding parent is away (bottles only). */
  away?: (at: number) => boolean;
  /** Fallback feed interval when the log is thin, in minutes (the entry type's due_after_min). */
  feedIntervalMin?: number;
}

const t = (iso: string) => new Date(iso).getTime();

/** Median of the values inside [lo, hi]; the fallback below three samples. */
export function median(xs: number[], fallback: number, lo = 10 * MIN, hi = 12 * H): number {
  const v = xs.filter((x) => x >= lo && x <= hi).sort((a, b) => a - b);
  return v.length >= 3 ? v[Math.floor(v.length / 2)] : fallback;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * How full a feed was, 0 (a few sips) to 1 (a proper feed). Breast: minutes on
 * the breast (5 min → 0, 20 min → 1); one side counts as half unless it ran
 * 20 min or more. Bottle: ml against her usual bottle (median of the last week).
 * Same rule as private.feed_fullness in the database.
 */
export function feedFullness(e: Pick<EntryRow, "payload" | "occurred_at" | "ended_at">, entries: EntryRow[] = []): number {
  const p = e.payload;
  const ml = Number(p.amount_ml);
  if (p.method === "Bottle" || (ml > 0 && p.method !== "Breast")) {
    if (!(ml > 0)) return 1;
    const mls = entries.filter((x) => x.type_id === "lana.feed" && x.payload.method === "Bottle").map((x) => Number(x.payload.amount_ml)).filter((n) => n > 20).sort((a, b) => a - b);
    const usual = mls.length >= 3 ? mls[Math.floor(mls.length / 2)] : 120;
    return clamp(ml / Math.max(usual, 30), 0, 1);
  }
  const mins = Number(p.duration_min) || (e.ended_at ? (t(e.ended_at) - t(e.occurred_at)) / MIN : 0);
  const byMin = mins ? clamp((mins - 5) / 15, 0, 1) : 1;
  const bySide = p.side === "Left" || p.side === "Right" ? (mins >= 20 ? 0.75 : 0.5) : 1;
  return Math.round(Math.min(byMin, bySide) * 100) / 100;
}

/**
 * When the next feed is due: from when the last one ended, shorter after a
 * small feed (half the gap at most, never under an hour). While Mama is away the
 * bottle interval caps it. Returns null with no feed in the log.
 */
export function nextFeedAt(entries: EntryRow[], opts: { gapMin: number; awayCapMin?: number; away?: (at: number) => boolean } ): { at: number; fullness: number; last: EntryRow } | null {
  const last = entries.filter((e) => e.type_id === "lana.feed").sort((a, b) => t(b.occurred_at) - t(a.occurred_at))[0];
  if (!last) return null;
  const from = t(last.ended_at ?? last.occurred_at);
  const fullness = feedFullness(last, entries);
  let gap = opts.gapMin * (0.5 + 0.5 * fullness);
  if (opts.awayCapMin && opts.away?.(from)) gap = Math.min(opts.awayCapMin, gap);
  return { at: from + Math.max(60, gap) * MIN, fullness, last };
}

/** "Short feed on the left · she may want the right side soon", or null after a proper feed. */
export function shortFeedHint(last: Pick<EntryRow, "payload" | "occurred_at" | "ended_at">, fullness: number): string | null {
  if (fullness >= 0.75) return null;
  const side = last.payload.side;
  if (last.payload.method === "Breast" && (side === "Left" || side === "Right")) return `Short feed on the ${String(side).toLowerCase()} · she may want the ${side === "Left" ? "right" : "left"} side soon`;
  return "Small feed · she may be hungry again sooner";
}

export function forecast(entries: EntryRow[], opts: ForecastOptions = {}): ForecastItem[] {
  const now = opts.now ?? Date.now();
  const end = now + (opts.hours ?? 12) * H;
  const away = opts.away ?? (() => false);
  const asc = [...entries].filter((e) => e.occurred_at).sort((a, b) => t(a.occurred_at) - t(b.occurred_at));

  const feeds = asc.filter((e) => e.type_id === "lana.feed");
  const gapsHome: number[] = [];
  const gapsAway: number[] = [];
  for (let i = 1; i < feeds.length; i++) {
    const prev = feeds[i - 1];
    const gap = t(feeds[i].occurred_at) - t(prev.ended_at ?? prev.occurred_at);
    (away(t(feeds[i].occurred_at)) ? gapsAway : gapsHome).push(gap);
  }
  const base = (opts.feedIntervalMin ?? 180) * MIN;
  const feedHome = clamp(median(gapsHome, base), 1.5 * H, 4 * H);
  const feedAway = clamp(median(gapsAway, Math.min(base, 2.5 * H)), 1.5 * H, 4 * H);

  const diapers = asc.filter((e) => e.type_id === "lana.diaper");
  const diaperGap = clamp(median(diapers.slice(1).map((e, i) => t(e.occurred_at) - t(diapers[i].occurred_at)), 3 * H), 1 * H, 6 * H);

  const sleeps = asc.filter((e) => e.type_id === "lana.sleep");
  const closed = sleeps.filter((e) => e.ended_at);
  const napLen = clamp(median(closed.map((e) => t(e.ended_at!) - t(e.occurred_at)), 1.5 * H), 20 * MIN, 4 * H);
  const awakeLen = clamp(median(closed.slice(1).map((e, i) => t(e.occurred_at) - t(closed[i].ended_at!)), 1.5 * H), 30 * MIN, 4 * H);

  const out: ForecastItem[] = [];
  const push = (kind: ForecastItem["kind"], at: number) => {
    if (at < end) out.push({ kind, at, due: at <= now });
  };

  // Feeds: the first from how much she took last time, then by the gap that applies at that hour.
  const lastFeed = feeds[feeds.length - 1];
  const step = (at: number) => (away(at) ? feedAway : feedHome);
  let f: number;
  if (lastFeed) {
    const from = t(lastFeed.ended_at ?? lastFeed.occurred_at);
    const first = nextFeedAt(asc, { gapMin: step(from) / MIN, awayCapMin: feedAway / MIN, away });
    f = first ? first.at : from + step(from);
  } else f = now + step(now);
  // An estimate more than 30 min old is stale: roll it forward.
  while (f < now - 30 * MIN) f += step(f);
  for (; f < end; f += step(f)) push("feed", f);

  const lastDiaper = diapers[diapers.length - 1];
  let d = (lastDiaper ? t(lastDiaper.occurred_at) : now) + diaperGap;
  while (d < now - 30 * MIN) d += diaperGap;
  for (; d < end; d += diaperGap) push("diaper", d);

  const lastSleep = sleeps[sleeps.length - 1];
  let s: number;
  if (lastSleep && !lastSleep.ended_at) {
    // Asleep now: the wake comes first.
    const wake = Math.max(now, t(lastSleep.occurred_at) + napLen);
    push("wake", wake);
    s = wake + awakeLen;
  } else {
    s = Math.max(now, (lastSleep?.ended_at ? t(lastSleep.ended_at) : now) + awakeLen);
  }
  for (; s < end; s += napLen + awakeLen) {
    push("sleep", s);
    push("wake", s + napLen);
  }

  return out.sort((a, b) => a.at - b.at);
}

export const FORECAST_LABEL: Record<ForecastItem["kind"], string> = { feed: "Feed", diaper: "Nappy", sleep: "Nap", wake: "Wakes up" };
