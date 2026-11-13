import type React from "react";
import { GIRLS, MONTH_DAYS, percentileLabel, percentileOf, type GrowthKind } from "@/lib/who";
import { dateWords } from "@/lib/time";

const LABEL: Record<GrowthKind, { title: string; unit: string }> = {
  weight_kg: { title: "Weight", unit: "kg" },
  length_cm: { title: "Length", unit: "cm" },
  head_cm: { title: "Head", unit: "cm" },
};

/**
 * The child's measurements on the WHO girls' curves: the 3rd to 97th percentile band,
 * the median, and the child's points, with the percentile of the latest one.
 */
export function GrowthChart({ kind, points, birthDate, children }: { kind: GrowthKind; points: { day: string; value: number }[]; birthDate: string; /** Under the chart, in the same card (the weight rows). */ children?: React.ReactNode }) {
  const c = GIRLS[kind];
  const age = (day: string) => (Date.parse(day) - Date.parse(birthDate)) / 86_400_000;
  const pts = points.filter((p) => p.value > 0 && age(p.day) >= 0).sort((a, b) => age(a.day) - age(b.day));
  if (pts.length === 0) return null;
  const last = pts[pts.length - 1];
  const lastMonths = age(last.day) / MONTH_DAYS;
  const maxM = Math.min(24, Math.max(6, Math.ceil(lastMonths + 2)));
  const W = 360;
  const H = 170;
  const padL = 34;
  const padB = 6;
  const idx = c.months.map((m, i) => i).filter((i) => c.months[i] <= maxM);
  const lo = Math.floor(Math.min(c.p3[0], ...pts.map((p) => p.value)) - 0.5);
  const hi = Math.ceil(Math.max(c.p97[idx[idx.length - 1]], ...pts.map((p) => p.value)) + 0.5);
  const x = (m: number) => padL + (m / maxM) * (W - padL - 8);
  const y = (v: number) => H - padB - ((v - lo) / (hi - lo)) * (H - padB - 6);
  const path = (vals: number[]) => idx.map((i) => `${x(c.months[i])},${y(vals[i])}`).join(" ");
  const band = `${path(c.p97)} ${idx.map((i) => `${x(c.months[i])},${y(c.p3[i])}`).reverse().join(" ")}`;
  const pct = percentileOf(kind, age(last.day), last.value);
  // Few enough axis numbers to read at 13 px: every 2 kg once the range is wide.
  const step = kind === "weight_kg" ? (hi - lo > 6 ? 2 : 1) : 5;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  return (
    <section className="card">
      <h2 className="font-semibold">{LABEL[kind].title}</h2>
      <p className="muted text-sm">
        {last.value} {LABEL[kind].unit} on {dateWords(new Date(`${last.day}T12:00:00Z`), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
        {pct != null ? `, ${percentileLabel(pct)} for a girl of this age` : ""}.
      </p>
      <div className="relative mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`${LABEL[kind].title} against the WHO curves`}>
        <polygon points={band} fill="var(--accent-soft)" opacity="0.8" />
        <polyline fill="none" stroke="var(--muted)" strokeWidth="1" strokeDasharray="4 3" points={path(c.p50)} />
        {ticks.map((v) => (
          <line key={v} x1={padL} x2={W} y1={y(v)} y2={y(v)} stroke="var(--line)" />
        ))}
        <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={pts.map((p) => `${x(age(p.day) / MONTH_DAYS)},${y(p.value)}`).join(" ")} />
        {pts.map((p) => (
          <g key={p.day}>
            <circle cx={x(age(p.day) / MONTH_DAYS)} cy={y(p.value)} r="3.5" fill="var(--accent)" />
            <title>{`${p.day}: ${p.value} ${LABEL[kind].unit}`}</title>
          </g>
        ))}
      </svg>
      {/* Axis words in the page, not the drawing, so they stay 13 px at any width. */}
      {ticks.map((v) => (
        <span key={v} className="muted absolute left-0 -translate-y-1/2 text-[13px] leading-none tabular-nums" style={{ top: `${(y(v) / H) * 100}%` }}>
          {v}
        </span>
      ))}
      </div>
      <div className="muted relative mt-1 h-4 text-[13px]">
        {Array.from({ length: Math.floor(maxM / 3) + 1 }, (_, i) => i * 3).map((m) => (
          <span key={m} className="absolute -translate-x-1/2 leading-none" style={{ left: `${(x(m) / W) * 100}%` }}>
            {m} mo
          </span>
        ))}
      </div>
      {children}
    </section>
  );
}
