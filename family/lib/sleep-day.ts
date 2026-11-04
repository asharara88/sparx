/**
 * The child's sleep across one day: the night she woke from, the naps, what
 * she is doing now and since when. Pure, so it is unit-tested; the component
 * draws it. A sleep is "night" when it was already running at midnight or
 * starts at or after the child's bedtime hour; everything else is a nap.
 */
export interface SleepLike {
  type_id: string;
  occurred_at: string;
  ended_at: string | null;
}

export interface SleepSegment {
  from: number;
  to: number;
  kind: "night" | "nap";
  /** Still running at "now". */
  open: boolean;
}

export type SleepState =
  | { kind: "asleep"; since: number; sleep: "night" | "nap" }
  | { kind: "awake"; since: number | null; afterNap: boolean }
  | { kind: "unknown" };

export interface SleepDaySummary {
  segments: SleepSegment[];
  state: SleepState;
  /** When the night ended this morning, or null when no night sleep ended today. */
  wokeAt: number | null;
  naps: number;
  napMin: number;
  nightMin: number;
}

const H12 = 12 * 60 * 60_000;

export function sleepDay(
  entries: readonly SleepLike[],
  dayStartMs: number,
  nowMs: number,
  opts: { bedtimeHour: number; hourOf: (ms: number) => number; sleepTypeId?: string },
): SleepDaySummary {
  const sleepType = opts.sleepTypeId ?? "lana.sleep";
  const dayEnd = dayStartMs + 24 * 60 * 60_000;
  const clipEnd = Math.min(nowMs, dayEnd);
  const sleeps = entries
    .filter((e) => e.type_id === sleepType)
    .map((e) => ({ start: Date.parse(e.occurred_at), end: e.ended_at ? Date.parse(e.ended_at) : null }))
    .filter((s) => Number.isFinite(s.start))
    .sort((a, b) => a.start - b.start);
  const segments: SleepSegment[] = [];
  let wokeAt: number | null = null;
  let naps = 0;
  let napMin = 0;
  let nightMin = 0;
  for (const s of sleeps) {
    const open = s.end == null;
    // A timer left on for over a day is not a sleep still going (DESIGN.md, rule 6).
    if (open && nowMs - s.start > 24 * 60 * 60_000) continue;
    const end = open ? nowMs : s.end!;
    if (end <= dayStartMs || s.start >= clipEnd) continue;
    const kind: "night" | "nap" = s.start < dayStartMs || opts.hourOf(s.start) >= opts.bedtimeHour ? "night" : "nap";
    const from = Math.max(s.start, dayStartMs);
    const to = Math.min(end, clipEnd);
    if (to <= from) continue;
    segments.push({ from, to, kind, open });
    const min = Math.round((to - from) / 60_000);
    if (kind === "nap") {
      naps += 1;
      napMin += min;
    } else {
      nightMin += min;
      if (!open && s.start < dayStartMs + H12 && s.end! > dayStartMs && s.end! <= clipEnd) wokeAt = s.end!;
    }
  }
  const running = sleeps.find((s) => s.end == null && nowMs - s.start <= 24 * 60 * 60_000 && s.start <= nowMs);
  let state: SleepState;
  if (running) {
    state = { kind: "asleep", since: running.start, sleep: running.start < dayStartMs || opts.hourOf(running.start) >= opts.bedtimeHour ? "night" : "nap" };
  } else {
    const last = [...sleeps].filter((s) => s.end != null && s.end <= nowMs).sort((a, b) => b.end! - a.end!)[0];
    if (!last || nowMs - last.end! > H12) state = { kind: "unknown" };
    else state = { kind: "awake", since: last.end!, afterNap: !(last.start < dayStartMs || opts.hourOf(last.start) >= opts.bedtimeHour) };
  }
  return { segments, state, wokeAt, naps, napMin, nightMin };
}
