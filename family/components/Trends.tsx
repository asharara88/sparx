"use client";
import { GrowthChart } from "@/components/GrowthChart";
import { useMemo, useState } from "react";
import type { DailyStats, DayStats } from "@/lib/types";
import { dateWords, fmtDuration } from "@/lib/time";
import { useMe } from "@/lib/me-context";
import { childName, childPronouns } from "@/lib/names";
import { AgeCheck } from "./AgeCheck";

/**
 * The child's trends: sleep, nights, feeds, diapers and weight, one bar per day.
 * Plain SVG, no chart library. Nights belong to the day they start on. Each chart's title
 * says the answer; colours are the features' own, named in words, not in a key (DESIGN.md).
 */
const RANGES = [
  { key: "2w", label: "2 weeks", days: 14 },
  { key: "6w", label: "6 weeks", days: 42 },
  { key: "all", label: "Since birth", days: 10_000 },
] as const;

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
// "1 h 30 min", not "1.5 h"; a per-day average keeps one decimal at most (DESIGN.md, Numbers).
const shortDay = (day: string) => dateWords(new Date(`${day}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" });
const longDay = (day: string) => dateWords(new Date(`${day}T12:00:00Z`), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const h = (min: number) => fmtDuration(Math.round(min));
const n1 = (x: number) => (Number.isInteger(x) ? `${x}` : x.toFixed(1).replace(/\.0$/, ""));
const mean = (days: DayStats[], k: keyof DayStats) => avg(days.map((d) => Number(d[k] ?? 0)));

export function Trends({ stats, today, birthDate }: { stats: DailyStats; today: string; birthDate: string | null }) {
  const me = useMe();
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("2w");
  const span = RANGES.find((r) => r.key === range)!.days;
  const all = stats.days;
  const days = useMemo(() => all.slice(-span), [all, span]);
  // the last day is today and only half done: compare whole days
  const done = days.filter((d) => d.day < today);
  const thisWeek = all.filter((d) => d.day < today).slice(-7);
  const ageWeeks = (day: string) => (birthDate ? Math.floor((Date.parse(day) - Date.parse(birthDate)) / 86_400_000 / 7) : null);

  const weekTotals = {
    breast_count: mean(thisWeek, "breast_count"),
    bottle_count: mean(thisWeek, "bottle_count"),
    bottle_ml: mean(thisWeek, "bottle_ml"),
    diapers_wet: mean(thisWeek, "diapers_wet"),
    diapers_dirty: mean(thisWeek, "diapers_dirty"),
    sleep_min: mean(thisWeek, "sleep_min"),
    night_sleep_min: mean(thisWeek, "night_sleep_min"),
  };
  const weights = all.filter((d) => d.weight_kg != null);
  const lengths = all.filter((d) => d.length_cm != null);
  const heads = all.filter((d) => d.head_cm != null);
  const milestones = all.filter((d) => d.milestones.length).flatMap((d) => d.milestones.map((m) => ({ day: d.day, what: m })));

  return (
    <div className="flex flex-col gap-4">
      {thisWeek.length > 0 && (
        <AgeCheck
          totals={weekTotals}
          birthDate={birthDate}
          day={thisWeek[thisWeek.length - 1].day}
          complete
          title={`This week against ${childPronouns(me).their} age`}
          subtitle="Average per day over the last 7 full days."
          name={childName(me)}
        />
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Range">
        {RANGES.map((r) => (
          <button key={r.key} type="button" className="chip" aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
            {r.label}
          </button>
        ))}
      </div>

      <Chart
        title={`Sleep: ${h(mean(done, "sleep_min"))} a day`}
        subtitle={`The night (${stats.night_from.slice(0, 5)} to ${stats.night_to.slice(0, 5)}) darker, naps lighter.`}
        days={days}
        max={16 * 60}
        ticks={[4 * 60, 8 * 60, 12 * 60, 16 * 60]}
        fmt={(v) => `${v / 60} h`}
        series={[
          { key: "night_sleep_min", color: "var(--sleep-fg)", label: "night" },
          { key: "nap", color: "var(--sleep)", stroke: "var(--sleep-fg)", label: "naps", value: (d) => Math.max(0, d.sleep_min - d.night_sleep_min) },
        ]}
      />
      <Chart
        title={`Longest stretch: ${h(mean(done, "longest_stretch_min"))} a night`}
        days={days}
        max={12 * 60}
        ticks={[3 * 60, 6 * 60, 9 * 60, 12 * 60]}
        fmt={(v) => `${v / 60} h`}
        series={[{ key: "longest_stretch_min", color: "var(--sleep-fg)", label: "longest stretch" }]}
      />
      <Chart
        title={`Feeds: ${n1(Math.round((mean(done, "breast_count") + mean(done, "bottle_count")) * 10) / 10)} a day`}
        subtitle="Breastfeeds darker, bottles lighter."
        days={days}
        max={Math.max(12, ...days.map((d) => d.breast_count + d.bottle_count))}
        ticks={[4, 8, 12, 16]}
        fmt={(v) => `${v}`}
        series={[
          { key: "breast_count", color: "var(--feed-fg)", label: "breastfeeds" },
          { key: "bottle_count", color: "var(--feed)", stroke: "var(--feed-fg)", label: "bottles" },
        ]}
      />
      {days.some((d) => d.bottle_ml > 0) && (
        <Chart
          title={`Bottle: ${Math.round(mean(done.filter((d) => d.bottle_ml > 0), "bottle_ml"))} ml on bottle days`}
          subtitle={days.some((d) => d.pump_ml > 0) ? "The line is what was pumped." : null}
          days={days}
          max={Math.max(300, ...days.map((d) => Math.max(d.bottle_ml, d.pump_ml)))}
          ticks={[100, 200, 300, 400, 500]}
          fmt={(v) => `${v}`}
          series={[{ key: "bottle_ml", color: "var(--milk-fg)", label: "ml" }]}
          line={days.some((d) => d.pump_ml > 0) ? { key: "pump_ml", color: "var(--pump-fg)", label: "pumped" } : undefined}
        />
      )}
      <Chart
        title={`Diapers: ${n1(Math.round(mean(done, "diapers") * 10) / 10)} a day`}
        subtitle="Dirty darker, wet lighter."
        days={days}
        max={Math.max(8, ...days.map((d) => d.diapers_wet + d.diapers_dirty))}
        ticks={[2, 4, 6, 8, 10]}
        fmt={(v) => `${v}`}
        series={[
          { key: "diapers_dirty", color: "var(--diaper-fg)", label: "dirty" },
          { key: "diapers_wet", color: "var(--diaper)", stroke: "var(--diaper-fg)", label: "wet" },
        ]}
      />

      {weights.length > 0 && (() => {
        const rows = (
          <ul className="mt-2 flex flex-col">
            {weights
              .slice()
              .reverse()
              .slice(0, 6)
              .map((w) => (
                <li key={w.day} className="row">
                  <span className="min-w-0 flex-1">
                    <span className="block">{longDay(w.day)}</span>
                    {ageWeeks(w.day) != null && <span className="muted block text-sm">{ageWeeks(w.day)} weeks old</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-semibold tabular-nums">{w.weight_kg} kg</span>
                    {w.length_cm && <span className="muted block text-sm tabular-nums">{w.length_cm} cm</span>}
                  </span>
                </li>
              ))}
          </ul>
        );
        // With a birth date the WHO chart is the weight card (its own title says the latest);
        // without one, a plain line.
        return birthDate ? (
          <GrowthChart kind="weight_kg" points={weights.map((w) => ({ day: w.day, value: Number(w.weight_kg) }))} birthDate={birthDate}>
            {rows}
          </GrowthChart>
        ) : (
          <section className="card">
            <h2 className="font-semibold">Weight</h2>
            <p className="muted text-sm">
              {weights[weights.length - 1].weight_kg} kg on {longDay(weights[weights.length - 1].day)}
              {weights.length > 1 ? `, up ${(Number(weights[weights.length - 1].weight_kg) - Number(weights[0].weight_kg)).toFixed(2)} kg since ${longDay(weights[0].day)}` : ""}.
            </p>
            <WeightChart points={weights} ageWeeks={ageWeeks} />
            {rows}
          </section>
        );
      })()}
      {birthDate && lengths.length > 0 && <GrowthChart kind="length_cm" points={lengths.map((d) => ({ day: d.day, value: Number(d.length_cm) }))} birthDate={birthDate} />}
      {birthDate && heads.length > 0 && <GrowthChart kind="head_cm" points={heads.map((d) => ({ day: d.day, value: Number(d.head_cm) }))} birthDate={birthDate} />}
      {birthDate && (weights.length > 0 || lengths.length > 0 || heads.length > 0) && (
        <p className="muted text-sm">Shaded: the 3rd to 97th percentile for girls (WHO Child Growth Standards, 2006); dashed: the median. The doctor&apos;s chart is the reference.</p>
      )}

      {milestones.length > 0 && (
        <section className="card">
          <h2 className="font-semibold">Firsts</h2>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {milestones
              .slice()
              .reverse()
              .map((m, i) => (
                <li key={i}>
                  <span className="muted">{longDay(m.day)}</span> · {m.what}
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type Series = { key: string; color: string; stroke?: string; label: string; value?: (d: DayStats) => number };

function Chart({
  title,
  subtitle = null,
  days,
  max,
  ticks,
  fmt,
  series,
  line,
}: {
  title: string;
  subtitle?: string | null;
  days: DayStats[];
  max: number;
  ticks: number[];
  fmt: (v: number) => string;
  series: Series[];
  line?: Series;
}) {
  const W = 360;
  const H = 140;
  const padL = 40;
  const padB = 4;
  const n = Math.max(days.length, 1);
  const bw = (W - padL) / n;
  const y = (v: number) => H - padB - (Math.min(v, max) / max) * (H - padB - 8);
  const val = (s: Series, d: DayStats) => (s.value ? s.value(d) : Number(d[s.key as keyof DayStats] ?? 0));
  // The axis words sit in the page, not in the drawing, so they stay 13 px at any width.
  const shown = ticks.filter((t) => t <= max);
  const marks = days.length ? [...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])].map((i) => days[i]) : [];
  return (
    <section className="card">
      <h2 className="font-semibold">{title}</h2>
      {subtitle && <p className="muted text-sm">{subtitle}</p>}
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`${title}, one bar per day`}>
          {shown.map((t) => (
            <line key={t} x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          ))}
          {days.map((d, i) => {
            let acc = 0;
            const x = padL + i * bw;
            return (
              <g key={d.day}>
                {series.map((s) => {
                  const v = val(s, d);
                  const top = y(acc + v);
                  const bottom = y(acc);
                  acc += v;
                  return v > 0 ? <rect key={s.key} x={x + bw * 0.15} y={top} width={bw * 0.7} height={Math.max(1, bottom - top)} fill={s.color} stroke={s.stroke} strokeWidth={s.stroke ? 1 : 0} /> : null;
                })}
                <title>{`${longDay(d.day)}: ${series.map((s) => `${s.label} ${fmt(val(s, d))}`).join(", ")}`}</title>
              </g>
            );
          })}
          {line && <polyline fill="none" stroke={line.color} strokeWidth="2" points={days.map((d, i) => `${padL + i * bw + bw / 2},${y(val(line, d))}`).join(" ")} />}
        </svg>
        {shown.map((t) => (
          <span key={t} className="muted absolute left-0 -translate-y-1/2 text-[13px] leading-none tabular-nums" style={{ top: `${(y(t) / H) * 100}%` }}>
            {fmt(t)}
          </span>
        ))}
      </div>
      <div className="muted mt-1 flex justify-between text-[13px]" style={{ paddingLeft: `${(padL / W) * 100}%` }}>
        {marks.map((d) => (
          <span key={d.day}>{shortDay(d.day)}</span>
        ))}
      </div>
    </section>
  );
}

export function WeightChart({ points, ageWeeks = () => null }: { points: { day: string; weight_kg: number | null }[]; ageWeeks?: (d: string) => number | null }) {
  const W = 360;
  const H = 140;
  const padL = 34;
  const padB = 18;
  const t0 = Date.parse(points[0].day);
  const t1 = Math.max(Date.parse(points[points.length - 1].day), t0 + 7 * 86_400_000);
  const ws = points.map((p) => Number(p.weight_kg));
  const lo = Math.floor(Math.min(...ws) * 2) / 2 - 0.5;
  const hi = Math.ceil(Math.max(...ws) * 2) / 2 + 0.5;
  const x = (day: string) => padL + ((Date.parse(day) - t0) / (t1 - t0)) * (W - padL - 8);
  const y = (kg: number) => H - padB - ((kg - lo) / (hi - lo)) * (H - padB - 6);
  const ticks: number[] = [];
  for (let k = lo; k <= hi + 0.001; k += 0.5) ticks.push(Math.round(k * 2) / 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="Weight over time">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={padL - 4} y={y(t) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">
            {t.toFixed(1)}
          </text>
        </g>
      ))}
      <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={points.map((p) => `${x(p.day)},${y(Number(p.weight_kg))}`).join(" ")} />
      {points.map((p) => (
        <g key={p.day}>
          <circle cx={x(p.day)} cy={y(Number(p.weight_kg))} r="3.5" fill="var(--accent)" />
          <title>{`${p.day}: ${p.weight_kg} kg${ageWeeks(p.day) != null ? ` at ${ageWeeks(p.day)} weeks` : ""}`}</title>
        </g>
      ))}
      {points
        .filter((_, i) => i % Math.ceil(points.length / 6) === 0 || i === points.length - 1)
        .map((p) => (
          <text key={p.day} x={x(p.day)} y={H - 4} fontSize="9" textAnchor="middle" fill="var(--muted)">
            {ageWeeks(p.day) != null ? `${ageWeeks(p.day)} wk` : p.day.slice(5)}
          </text>
        ))}
    </svg>
  );
}
