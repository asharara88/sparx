"use client";
import { useEffect, useState } from "react";
import { fmtDuration } from "@/lib/time";

/**
 * The parts of "Sleep today" that move while the tab stays open: how long she
 * has been awake or asleep, and the bar's "now" mark with any sleep still
 * running drawn up to it. The clock starts on the server's time so the first
 * paint matches the server-rendered screen, then this phone's clock takes over
 * every 30 seconds (as HomeState does).
 */
function useClock(clockIso: string): number {
  const [now, setNow] = useState(() => Date.parse(clockIso));
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function SleepSince({ sinceIso, clockIso, prefix }: { sinceIso: string; clockIso: string; prefix: string }) {
  const now = useClock(clockIso);
  const min = Math.max(0, Math.round((now - Date.parse(sinceIso)) / 60_000));
  return (
    <span className="muted text-sm tabular-nums">
      {prefix}
      {fmtDuration(min)}
    </span>
  );
}

export interface BarSegment {
  from: number;
  to: number;
  kind: "night" | "nap";
  open: boolean;
}

export function SleepBar({ segments, dayStartMs, clockIso, live, label }: { segments: BarSegment[]; dayStartMs: number; clockIso: string; live: boolean; label: string }) {
  const now = useClock(clockIso);
  const W = 1440;
  const H = 16;
  const dayEnd = dayStartMs + 24 * 60 * 60_000;
  const nowClip = Math.min(now, dayEnd);
  const x = (ms: number) => Math.max(0, Math.min(W, (ms - dayStartMs) / 60_000));
  return (
    <svg viewBox={`0 0 ${W} ${H + 4}`} className="h-6 w-full" preserveAspectRatio="none" role="img" aria-label={label}>
      <rect x={0} y={0} width={W} height={H} rx={4} fill="var(--card)" />
      {[360, 720, 1080].map((t) => (
        <line key={t} x1={t} x2={t} y1={0} y2={H} stroke="var(--line)" strokeWidth={2} />
      ))}
      {segments.map((g, i) => {
        const to = g.open && live ? Math.max(g.to, nowClip) : g.to;
        return <rect key={i} x={x(g.from)} y={0} width={Math.max(6, x(to) - x(g.from))} height={H} rx={3} fill="var(--sleep-fg)" opacity={g.kind === "night" ? 1 : 0.55} />;
      })}
      {live && now < dayEnd && <rect x={x(now) - 2} y={0} width={4} height={H + 4} fill="var(--fg)" />}
    </svg>
  );
}
