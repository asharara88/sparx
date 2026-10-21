import Link from "next/link";
import type { EntryRow } from "@/lib/types";
import { FORECAST_LABEL, forecast, type ForecastItem } from "@/lib/forecast";
import { fmtTime } from "@/lib/time";
import { Icon, type IconName } from "@/components/Icon";

const ICON: Record<ForecastItem["kind"], IconName> = { feed: "bottle", diaper: "diaper", sleep: "zzz", wake: "sun" };

/**
 * The next hours as a glance: "feed ~15:10, nap ~16:00". Estimated from the
 * last 7 days of the child's log and the work hours of whoever breastfeeds; nothing
 * here is logged. Server-rendered; it refreshes with the page.
 */
export function LanaForecast({ entries, timezone, away, feedIntervalMin, hours = 12, limit, title = "Coming up", compact = false }: { entries: EntryRow[]; timezone: string; away?: (at: number) => boolean; feedIntervalMin?: number; hours?: number; limit?: number; title?: string; compact?: boolean }) {
  const items = forecast(entries, { hours, away, feedIntervalMin });
  const shown = limit ? items.slice(0, limit) : items;
  if (shown.length === 0) return null;
  if (compact) {
    return (
      <Link href="/baby" className="card-flat row-link flex items-center gap-3 no-underline" aria-label={title}>
        <Icon name="clock" size={20} />
        <span className="min-w-0 flex-1 truncate text-sm">
          {shown.map((i, n) => (
            <span key={i.kind + i.at}>
              {n > 0 ? " · " : ""}
              <b>{FORECAST_LABEL[i.kind]}</b> {i.due ? "now" : `~${fmtTime(new Date(i.at).toISOString(), timezone)}`}
            </span>
          ))}
        </span>
        <Icon name="forward" size={18} className="muted" />
      </Link>
    );
  }
  return (
    <section className="card" aria-labelledby="fc-h">
      <h2 id="fc-h" className="font-semibold">
        {title}
      </h2>
      <p className="muted text-sm">A guess from the last 7 days. It moves as you log.</p>
      <ul className="mt-2 flex flex-col">
        {shown.map((i) => (
          <li key={i.kind + i.at} className="row">
            <Icon name={ICON[i.kind]} size={20} className={i.due ? "text-[var(--accent)]" : "muted"} />
            <span className="grow font-semibold">{FORECAST_LABEL[i.kind]}</span>
            <span className={`tabular-nums ${i.due ? "font-bold text-[var(--accent)]" : "muted"}`}>{i.due ? "Due now" : `~${fmtTime(new Date(i.at).toISOString(), timezone)}`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
