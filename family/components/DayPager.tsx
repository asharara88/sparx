import Link from "next/link";
import { dayLabel } from "@/lib/by-day";
import { dayHref, type DayNav } from "@/lib/day-nav";
import { dateWords } from "@/lib/time";
import { DaySwipe } from "./DaySwipe";
import { Icon } from "./Icon";

/**
 * The day a section is showing, with the way to the day before and after (DESIGN.md, "Day
 * pager"): "Today" over "Tue 24 Nov" (or "Wednesday" over "18 Nov") between two arrows. A swipe across the screen does what
 * the arrows do (DaySwipe). At either end the arrow is there but faint and does nothing, so
 * the title never jumps sideways.
 */
export function DayPager({ base, nav, today }: { /** The section's address ("/baby/feed"). */ base: string; nav: DayNav; today: string }) {
  const prev = dayHref(base, nav.prev, today);
  const next = dayHref(base, nav.next, today);
  const arrow = (href: string | null, icon: "back" | "forward", label: string) =>
    href ? (
      <Link prefetch={false} href={href} className="icon-btn m-0" aria-label={label}>
        <Icon name={icon} size={22} />
      </Link>
    ) : (
      <span className="icon-btn m-0 opacity-25" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
    );
  // "Today" and "Yesterday" get the weekday under them; a day named by its weekday gets the date alone.
  const name = dayLabel(nav.day, today);
  const named = name === "Today" || name === "Yesterday";
  return (
    <nav className="daypager" aria-label="Days">
      {arrow(prev, "back", "The day before")}
      <p className="daypager-title" aria-live="polite">
        <b>{name}</b>
        <span className="muted">{dateWords(new Date(`${nav.day}T12:00:00Z`), { ...(named ? { weekday: "short" as const } : {}), day: "numeric", month: "short", timeZone: "UTC" })}</span>
      </p>
      {arrow(next, "forward", "The day after")}
      <DaySwipe prev={prev} next={next} />
    </nav>
  );
}
