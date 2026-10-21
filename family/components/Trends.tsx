"use client";
import { GrowthChart } from "@/components/GrowthChart";
import { useMemo, useState } from "react";
import type { DailyStats, DayStats } from "@/lib/types";
import { fmtDuration } from "@/lib/time";
import { useMe } from "@/lib/me-context";
import { childName, childPronouns } from "@/lib/names";
import { AgeCheck } from "./AgeCheck";

/**
 * The child's trends: sleep, nights, feeds, diapers and weight, one bar per day.
 * Plain SVG, no chart library. Nights belong to the day they start on.
 */
const RANGES = [
  { key: "2w", label: "2 weeks", days: 14 },
  { key: "6w", label: "6 weeks", days: 42 },
  { key: "all", label: "Since birth", days: 10_000 },
] as const;

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const h = (min: number) => `${(min / 60).toFixed(1)} h`;
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
  const lastWeek = all.filter((d) => d.day < today).slice(-14, -7);
  const ageWeeks = (day: string) => (birthDate ? Math.floor((Date.parse(day) - Date.parse(birthDate)) / 86_400_000 / 7) : null);

  const tiles: { label: string; now: string; delta?: number; unit: string }[] = [
    { label: "Sleep a day", now: h(mean(thisWeek, "sleep_min")), delta: mean(thisWeek, "sleep_min") - mean(lastWeek, "sleep_min"), unit: "min" },
    { label: "Night sleep", now: h(mean(thisWeek, "night_sleep_min")), delta: mean(thisWeek, "night_sleep_min") - mean(lastWeek, "night_sleep_min"), unit: "min" },
    { label: "Longest stretch", now: h(mean(thisWeek, "longest_stretch_min")), delta: mean(thisWeek, "longest_stretch_min") - mean(lastWeek, "longest_stretch_min"), unit: "min" },
    { label: "Night feeds", now: mean(thisWeek, "night_feeds").toFixed(1), delta: mean(thisWeek, "night_feeds") - mean(lastWeek, "night_feeds"), unit: "" },
    { label: "Breastfeeds a day", now: mean(thisWeek, "breast_count").toFixed(1), delta: mean(thisWeek, "breast_count") - mean(lastWeek, "breast_count"), unit: "" },
    { label: "At the breast", now: fmtDuration(Math.round(mean(thisWeek, "breast_min"))), delta: mean(thisWeek, "breast_min") - mean(lastWeek, "breast_min"), unit: "min" },
    { label: "Bottle a day", now: `${Math.round(mean(thisWeek, "bottle_ml"))} ml`, delta: mean(thisWeek, "bottle_ml") - mean(lastWeek, "bottle_ml"), unit: "ml" },
    { label: "Diapers a day", now: mean(thisWeek, "diapers").toFixed(1), delta: mean(thisWeek, "diapers") - mean(lastWeek, "diapers"), unit: "" },
  ];
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
      <section className="card">
        <h2 className="font-semibold">This week, per day</h2>
        <p className="muted text-sm">Last 7 full days, against the 7 before. Only what was written down counts, so a day with few notes looks like a quiet day.</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl bg-[var(--card-2)] p-2">
              <p className="text-sm">{t.label}</p>
              <p className="text-xl font-bold">{t.now}</p>
              {t.delta != null && lastWeek.length > 0 && (
                <p className="muted text-sm">
                  {t.delta > 0 ? "▲" : t.delta < 0 ? "▼" : "•"} {Math.abs(t.unit === "min" && Math.abs(t.delta) >= 60 ? t.delta / 60 : t.delta).toFixed(1)}
                  {t.unit === "min" ? (Math.abs(t.delta) >= 60 ? " h" : " min") : t.unit ? ` ${t.unit}` : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

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
        title="Sleep"
        subtitle={`Night (${stats.night_from.slice(0, 5)}–${stats.night_to.slice(0, 5)}) in dark purple, naps in light. Average ${h(mean(done, "sleep_min"))} a day.`}
        days={days}
        max={16 * 60}
        ticks={[4 * 60, 8 * 60, 12 * 60, 16 * 60]}
        fmt={(v) => `${v / 60}h`}
        series={[
          { key: "night_sleep_min", color: "#6d28d9", label: "night" },
          { key: "nap", color: "#c4b5fd", label: "naps", value: (d) => Math.max(0, d.sleep_min - d.night_sleep_min) },
        ]}
      />
      <Chart
        title="Longest night stretch"
        subtitle={`The longest unbroken sleep each night. Average ${h(mean(done, "longest_stretch_min"))}.`}
        days={days}
        max={12 * 60}
        ticks={[3 * 60, 6 * 60, 9 * 60, 12 * 60]}
        fmt={(v) => `${v / 60}h`}
        series={[{ key: "longest_stretch_min", color: "#4338ca", label: "stretch" }]}
      />
      <Chart
        title="Feeds"
        subtitle={`Breastfeeds (blue, left darker) and bottles (sky). ${Math.round(mean(done, "breast_count"))} breast and ${mean(done, "bottle_count").toFixed(1)} bottle a day on average.`}
        days={days}
        max={Math.max(12, ...days.map((d) => d.breast_count + d.bottle_count))}
        ticks={[4, 8, 12, 16]}
        fmt={(v) => `${v}`}
        series={[
          { key: "left_count", color: "#1d4ed8", label: "left" },
          { key: "right_count", color: "#60a5fa", label: "right" },
          { key: "other", color: "#93c5fd", label: "side ?", value: (d) => Math.max(0, d.breast_count - d.left_count - d.right_count) },
          { key: "bottle_count", color: "#7dd3fc", label: "bottle" },
        ]}
      />
      {days.some((d) => d.bottle_ml > 0) && (
        <Chart
          title="Bottle"
          subtitle={`Millilitres a day. Pumped in green. Average ${Math.round(mean(done.filter((d) => d.bottle_ml > 0), "bottle_ml"))} ml on bottle days.`}
          days={days}
          max={Math.max(300, ...days.map((d) => Math.max(d.bottle_ml, d.pump_ml)))}
          ticks={[100, 200, 300, 400, 500]}
          fmt={(v) => `${v}`}
          series={[{ key: "bottle_ml", color: "#0284c7", label: "ml" }]}
          line={{ key: "pump_ml", color: "#15803d", label: "pumped" }}
        />
      )}
      <Chart
        title="Diapers"
        subtitle={`Wet (yellow) and dirty (brown). ${mean(done, "diapers").toFixed(1)} a day on average.`}
        days={days}
        max={Math.max(8, ...days.map((d) => d.diapers_wet + d.diapers_dirty))}
        ticks={[2, 4, 6, 8, 10]}
        fmt={(v) => `${v}`}
        series={[
          { key: "diapers_wet", color: "#fbbf24", label: "wet" },
          { key: "diapers_dirty", color: "#92400e", label: "dirty" },
        ]}
      />

      {weights.length > 0 && (
        <section className="card">
          <h2 className="font-semibold">Weight</h2>
          <p className="muted text-sm">
            {weights[weights.length - 1].weight_kg} kg on {weights[weights.length - 1].day}
            {weights.length > 1 ? `, up ${(Number(weights[weights.length - 1].weight_kg) - Number(weights[0].weight_kg)).toFixed(2)} kg since ${weights[0].day}` : ""}.
          </p>
          {birthDate ? <GrowthChart kind="weight_kg" points={weights.map((w) => ({ day: w.day, value: Number(w.weight_kg) }))} birthDate={birthDate} /> : <WeightChart points={weights} ageWeeks={ageWeeks} />}
          <table className="mt-2 w-full text-sm">
            <tbody>
              {weights
                .slice()
                .reverse()
                .slice(0, 6)
                .map((w) => (
                  <tr key={w.day}>
                    <td className="py-0.5">{w.day}</td>
                    <td className="muted">{ageWeeks(w.day) != null ? `${ageWeeks(w.day)} wk` : ""}</td>
                    <td className="text-right font-semibold">{w.weight_kg} kg</td>
                    <td className="muted text-right">{w.length_cm ? `${w.length_cm} cm` : ""}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}
      {birthDate && lengths.length > 0 && <GrowthChart kind="length_cm" points={lengths.map((d) => ({ day: d.day, value: Number(d.length_cm) }))} birthDate={birthDate} />}
      {birthDate && heads.length > 0 && <GrowthChart kind="head_cm" points={heads.map((d) => ({ day: d.day, value: Number(d.head_cm) }))} birthDate={birthDate} />}

      {milestones.length > 0 && (
        <section className="card">
          <h2 className="font-semibold">Firsts</h2>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {milestones
              .slice()
              .reverse()
              .map((m, i) => (
                <li key={i}>
                  <span className="muted">{m.day}</span> · {m.what}
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type Series = { key: string; color: string; label: string; value?: (d: DayStats) => number };

function Chart({
  title,
  subtitle,
  days,
  max,
  ticks,
  fmt,
  series,
  line,
}: {
  title: string;
  subtitle: string;
  days: DayStats[];
  max: number;
  ticks: number[];
  fmt: (v: number) => string;
  series: Series[];
  line?: Series;
}) {
  const W = 360;
  const H = 150;
  const padL = 30;
  const padB = 18;
  const n = Math.max(days.length, 1);
  const bw = (W - padL) / n;
  const y = (v: number) => H - padB - (Math.min(v, max) / max) * (H - padB - 6);
  const val = (s: Series, d: DayStats) => (s.value ? s.value(d) : Number(d[s.key as keyof DayStats] ?? 0));
  const labelEvery = n > 40 ? 14 : n > 20 ? 7 : n > 10 ? 2 : 1;
  return (
    <section className="card">
      <h2 className="font-semibold">{title}</h2>
      <p className="muted text-sm">{subtitle}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={`${title}, one bar per day`}>
        {ticks
          .filter((t) => t <= max)
          .map((t) => (
            <g key={t}>
              <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" />
              <text x={padL - 4} y={y(t) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">
                {fmt(t)}
              </text>
            </g>
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
                return v > 0 ? <rect key={s.key} x={x + bw * 0.15} y={top} width={bw * 0.7} height={Math.max(1, bottom - top)} fill={s.color} /> : null;
              })}
              {i % labelEvery === 0 && (
                <text x={x + bw / 2} y={H - 4} fontSize="9" textAnchor="middle" fill="var(--muted)">
                  {d.day.slice(5).replace("-", "/")}
                </text>
              )}
              <title>{`${d.day}: ${series.map((s) => `${s.label} ${fmt(val(s, d))}`).join(", ")}`}</title>
            </g>
          );
        })}
        {line && (
          <polyline
            fill="none"
            stroke={line.color}
            strokeWidth="2"
            points={days.map((d, i) => `${padL + i * bw + bw / 2},${y(val(line, d))}`).join(" ")}
          />
        )}
      </svg>
      <p className="muted mt-1 flex flex-wrap gap-3 text-xs">
        {[...series, ...(line ? [line] : [])].map((s) => (
          <span key={s.key}>
            <span className="inline-block h-3 w-3 rounded-sm align-middle" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </p>
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
