import Link from "next/link";
import { dayLabel } from "@/lib/by-day";
import { dayHref, type DayNav } from "@/lib/day-nav";
import { dateWords } from "@/lib/time";
import { DaySwipe } from "./DaySwipe";
import { Icon } from "./Icon";

/**
 * One of a row of screens, with the way to the one before and after (DESIGN.md, "Pager"): a
 * name over a smaller line between two arrows. A swipe across the screen does what the arrows
 * do (DaySwipe). At either end the arrow is there but faint and does nothing, so the title
 * never jumps sideways. Sleep and Feeds page through days (DayPager below); Week by week
 * pages through the stretches.
 */
export function Pager({ prev, next, title, sub = null, label, prevLabel, nextLabel }: { /** The addresses the arrows and the swipe go to; null at an end. */ prev: string | null; next: string | null; title: string; sub?: string | null; /** What the row is, for a screen reader ("Days"). */ label: string; prevLabel: string; nextLabel: string }) {
  const arrow = (href: string | null, icon: "back" | "forward", words: string) =>
    href ? (
      <Link prefetch={false} href={href} className="icon-btn m-0" aria-label={words}>
        <Icon name={icon} size={22} />
      </Link>
    ) : (
      <span className="icon-btn m-0 opacity-25" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
    );
  return (
    <nav className="daypager" aria-label={label}>
      {arrow(prev, "back", prevLabel)}
      <p className="daypager-title" aria-live="polite">
        <b>{title}</b>
        {sub && <span className="muted">{sub}</span>}
      </p>
      {arrow(next, "forward", nextLabel)}
      <DaySwipe prev={prev} next={next} />
    </nav>
  );
}

/** The day a section is showing: "Today" over "Tue 24 Nov" (or "Wednesday" over "18 Nov"). */
export function DayPager({ base, nav, today }: { /** The section's address ("/baby/feed"). */ base: string; nav: DayNav; today: string }) {
  // "Today" and "Yesterday" get the weekday under them; a day named by its weekday gets the date alone.
  const name = dayLabel(nav.day, today);
  const named = name === "Today" || name === "Yesterday";
  return (
    <Pager
      prev={dayHref(base, nav.prev, today)}
      next={dayHref(base, nav.next, today)}
      title={name}
      sub={dateWords(new Date(`${nav.day}T12:00:00Z`), { ...(named ? { weekday: "short" as const } : {}), day: "numeric", month: "short", timeZone: "UTC" })}
      label="Days"
      prevLabel="The day before"
      nextLabel="The day after"
    />
  );
}
